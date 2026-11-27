import Foundation
import UIKit
import SwiftUI
import HealthKit
import Capacitor
#if canImport(WorkoutKit)
import WorkoutKit
#endif

// VEYVO -> Apple Watch through Apple's WorkoutKit (iOS 17+, watchOS 10+).
//
// JS: Capacitor.Plugins.VeyvoWorkoutKit, wrapped by VeyvoPlatform.watch (src/platform.js).
//
//   isSupported()                    -> { supported, preview, schedule, maxScheduled?, reason? }
//   preview({ workoutJson, indoor, planId? })
//                                    -> { shown: true } once Apple's workout preview sheet closes
//   schedule({ workoutJson, indoor, planId?, date: 'YYYY-MM-DD', hour })
//                                    -> { scheduled: true, id, date, replaced }
//   listScheduled()                  -> { workouts: [{ id, date, time, name, complete }] }
//   clearScheduled()                 -> { removed }
//
// workoutJson is VEYVO's workout model (docs/architecture.md) as JSON, built by
// VeyvoPlatform.util.watchPayload: { id, name, date?, steps: [Step | Repeat] } with
//   Step   = { kind: 'step', intensity: 'warmup' | 'active' | 'recovery' | 'rest' | 'cooldown',
//              duration: { type: 'time', seconds } | { type: 'distance', meters } | { type: 'open' },
//              target: { type: 'open' } | { type: 'pace', fastSecPerKm, slowSecPerKm } | { type: 'hr', lowBpm, highBpm },
//              label? }
//   Repeat = { kind: 'repeat', count: 1...99, steps: [Step] }   (one level)
//
// Mapping (the same as the .workout file in src/core/export/apple.js):
//   first item = 'warmup' step -> CustomWorkout.warmup; last item = 'cooldown' step -> cooldown
//   (a workout made only of those two becomes blocks); every other item becomes an IntervalBlock:
//   Repeat -> IntervalBlock(iterations: count), a plain Step -> IntervalBlock(iterations: 1).
//   'active' -> IntervalStep(.work); 'recovery', 'rest' and a misplaced warm-up / cool-down -> .recovery.
//   time -> WorkoutGoal.time(seconds), distance -> .distance(meters), open -> .open.
//   pace -> SpeedRangeAlert (current speed): the slower pace is the lower speed, 1000 / slowSecPerKm
//   m/s up to 1000 / fastSecPerKm m/s. hr -> HeartRateRangeAlert in counts per minute. Step labels
//   become WorkoutStep.displayName on iOS 18+ (iOS 17 has no step names and shows Apple's own).
//   Every goal and alert is checked with CustomWorkout.supportsGoal / supportsAlert first.
//
// Error codes (call.reject(message, code)): watch_unsupported, watch_invalid, watch_step_unsupported,
// watch_busy, watch_denied, watch_limit, watch_date, watch_failed. Texts: platform.error.<code>.

// MARK: - VEYVO workout model (decoded from workoutJson)

struct VeyvoWatchWorkout: Decodable {
    let id: String?
    let name: String
    let date: String?
    let steps: [VeyvoWatchItem]
}

enum VeyvoWatchItem: Decodable {
    case step(VeyvoWatchStep)
    case repeated(count: Int, steps: [VeyvoWatchStep])

    private enum CodingKeys: String, CodingKey {
        case kind
        case count
        case steps
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let kind = try container.decode(String.self, forKey: .kind)
        if kind == "repeat" {
            let count = try container.decode(Int.self, forKey: .count)
            let steps = try container.decode([VeyvoWatchStep].self, forKey: .steps)
            self = .repeated(count: count, steps: steps)
        } else if kind == "step" {
            let step = try VeyvoWatchStep(from: decoder)
            self = .step(step)
        } else {
            throw DecodingError.dataCorruptedError(forKey: .kind, in: container, debugDescription: "unknown kind \(kind)")
        }
    }
}

struct VeyvoWatchStep: Decodable {
    let intensity: String
    let duration: VeyvoWatchDuration
    let target: VeyvoWatchTarget
    let label: String?
}

struct VeyvoWatchDuration: Decodable {
    let type: String
    let seconds: Double?
    let meters: Double?
}

struct VeyvoWatchTarget: Decodable {
    let type: String
    let fastSecPerKm: Double?
    let slowSecPerKm: Double?
    let lowBpm: Double?
    let highBpm: Double?
}

enum VeyvoWatchError: Error {
    case unsupported(String)
    case invalid(String)
    case stepUnsupported(String)
    case busy
    case denied
    case limit
    case date
    case failed(String)

    var code: String {
        switch self {
        case .unsupported: return "watch_unsupported"
        case .invalid: return "watch_invalid"
        case .stepUnsupported: return "watch_step_unsupported"
        case .busy: return "watch_busy"
        case .denied: return "watch_denied"
        case .limit: return "watch_limit"
        case .date: return "watch_date"
        case .failed: return "watch_failed"
        }
    }

    var message: String {
        switch self {
        case .unsupported(let why): return why
        case .invalid(let why): return "invalid workout: \(why)"
        case .stepUnsupported(let why): return "not supported by Apple Watch: \(why)"
        case .busy: return "a workout preview is already open"
        case .denied: return "workout scheduling is not authorized"
        case .limit: return "the scheduled workout limit is reached"
        case .date: return "the date must be today or later"
        case .failed(let why): return why
        }
    }
}

/// A local calendar day from 'YYYY-MM-DD'.
struct VeyvoDay {
    let year: Int
    let month: Int
    let day: Int

    init?(_ text: String?) {
        guard let text = text, text.count == 10 else { return nil }
        let parts = text.split(separator: "-", omittingEmptySubsequences: false).map { Int($0) }
        guard parts.count == 3, let y = parts[0], let m = parts[1], let d = parts[2],
              y >= 2000, y <= 2200, (1...12).contains(m), (1...31).contains(d) else { return nil }
        year = y
        month = m
        day = d
    }

    var key: String { String(format: "%04d-%02d-%02d", year, month, day) }

    /// That day at `hour`:00 local time; nil for a day that does not exist (2026-02-30).
    func date(hour: Int, calendar: Calendar) -> Date? {
        var components = DateComponents()
        components.year = year
        components.month = month
        components.day = day
        components.hour = hour
        components.minute = 0
        guard let date = calendar.date(from: components),
              calendar.component(.day, from: date) == day,
              calendar.component(.month, from: date) == month else { return nil }
        return date
    }
}

enum VeyvoDayText {
    static func formatter(_ format: String) -> DateFormatter {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.calendar = Calendar(identifier: .gregorian)
        formatter.timeZone = TimeZone.current
        formatter.dateFormat = format
        return formatter
    }
}

// MARK: - WorkoutKit (iOS 17+)

#if canImport(WorkoutKit)

@available(iOS 17.0, *)
enum VeyvoWorkoutBuilder {
    static let activity: HKWorkoutActivityType = .running
    static let maxItems = 60

    static func plan(from model: VeyvoWatchWorkout, indoor: Bool, planId: UUID?) throws -> WorkoutPlan {
        let workout = try customWorkout(from: model, indoor: indoor)
        return WorkoutPlan(.custom(workout), id: planId ?? UUID())
    }

    static func customWorkout(from model: VeyvoWatchWorkout, indoor: Bool) throws -> CustomWorkout {
        let location: HKWorkoutSessionLocationType = indoor ? .indoor : .outdoor
        let name = model.name.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !name.isEmpty else { throw VeyvoWatchError.invalid("the workout has no name") }
        let items = model.steps
        guard !items.isEmpty else { throw VeyvoWatchError.invalid("the workout has no steps") }
        guard items.count <= maxItems else { throw VeyvoWatchError.invalid("too many steps") }

        // Apple keeps a warm-up only first and a cool-down only last (src/core/export/apple.js layout).
        var start = 0
        var end = items.count
        if case .step(let first) = items[0], first.intensity == "warmup" { start = 1 }
        if end > start, case .step(let last) = items[end - 1], last.intensity == "cooldown" { end -= 1 }
        var warmup: WorkoutStep? = nil
        var cooldown: WorkoutStep? = nil
        if end == start {
            start = 0
            end = items.count
        } else {
            if start == 1, case .step(let first) = items[0] {
                warmup = try workoutStep(first, location: location)
            }
            if end == items.count - 1, case .step(let last) = items[items.count - 1] {
                cooldown = try workoutStep(last, location: location)
            }
        }

        var blocks: [IntervalBlock] = []
        for item in items[start..<end] {
            switch item {
            case .step(let step):
                let single = try intervalStep(step, location: location)
                blocks.append(IntervalBlock(steps: [single], iterations: 1))
            case .repeated(let count, let steps):
                guard (1...99).contains(count) else { throw VeyvoWatchError.invalid("repeat count \(count)") }
                guard !steps.isEmpty else { throw VeyvoWatchError.invalid("empty repeat") }
                var intervalSteps: [IntervalStep] = []
                for step in steps {
                    let converted = try intervalStep(step, location: location)
                    intervalSteps.append(converted)
                }
                blocks.append(IntervalBlock(steps: intervalSteps, iterations: count))
            }
        }
        return CustomWorkout(activity: activity, location: location, displayName: String(name.prefix(60)),
                             warmup: warmup, blocks: blocks, cooldown: cooldown)
    }

    static func intervalStep(_ step: VeyvoWatchStep, location: HKWorkoutSessionLocationType) throws -> IntervalStep {
        let purpose: IntervalStep.Purpose = step.intensity == "active" ? .work : .recovery
        let converted = try workoutStep(step, location: location)
        return IntervalStep(purpose, step: converted)
    }

    static func workoutStep(_ step: VeyvoWatchStep, location: HKWorkoutSessionLocationType) throws -> WorkoutStep {
        let known = ["warmup", "active", "recovery", "rest", "cooldown"]
        guard known.contains(step.intensity) else { throw VeyvoWatchError.invalid("intensity \(step.intensity)") }
        let workoutGoal = try goal(for: step.duration, location: location)
        let workoutAlert = try alert(for: step.target, location: location)
        let label = (step.label ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        if !label.isEmpty {
            if #available(iOS 18.0, *) {
                return WorkoutStep(goal: workoutGoal, alert: workoutAlert, displayName: String(label.prefix(60)))
            }
        }
        return WorkoutStep(goal: workoutGoal, alert: workoutAlert)
    }

    static func goal(for duration: VeyvoWatchDuration, location: HKWorkoutSessionLocationType) throws -> WorkoutGoal {
        let result: WorkoutGoal
        switch duration.type {
        case "time":
            guard let seconds = duration.seconds, seconds.isFinite, seconds >= 1, seconds <= 86_400 else {
                throw VeyvoWatchError.invalid("step time")
            }
            result = .time(seconds, .seconds)
        case "distance":
            guard let meters = duration.meters, meters.isFinite, meters >= 1, meters <= 1_000_000 else {
                throw VeyvoWatchError.invalid("step distance")
            }
            result = .distance(meters, .meters)
        case "open":
            result = .open
        default:
            throw VeyvoWatchError.invalid("duration \(duration.type)")
        }
        guard CustomWorkout.supportsGoal(result, activity: activity, location: location) else {
            throw VeyvoWatchError.stepUnsupported("\(duration.type) goal")
        }
        return result
    }

    static func alert(for target: VeyvoWatchTarget, location: HKWorkoutSessionLocationType) throws -> (any WorkoutAlert)? {
        switch target.type {
        case "open":
            return nil
        case "pace":
            guard let fast = target.fastSecPerKm, let slow = target.slowSecPerKm, fast.isFinite, slow.isFinite,
                  fast >= 60, slow <= 1800, fast < slow else {
                throw VeyvoWatchError.invalid("pace range")
            }
            // A faster pace is a higher speed: the slow pace gives the lower bound.
            let lower = Measurement(value: 1000.0 / slow, unit: UnitSpeed.metersPerSecond)
            let upper = Measurement(value: 1000.0 / fast, unit: UnitSpeed.metersPerSecond)
            let speed = SpeedRangeAlert(target: lower...upper, metric: .current)
            guard CustomWorkout.supportsAlert(speed, activity: activity, location: location) else {
                throw VeyvoWatchError.stepUnsupported("pace alert")
            }
            return speed
        case "hr":
            guard let low = target.lowBpm, let high = target.highBpm, low.isFinite, high.isFinite,
                  low >= 30, high <= 250, low < high else {
                throw VeyvoWatchError.invalid("heart rate range")
            }
            let perMinute = WorkoutAlertMetric.countPerMinute
            let heartRate = HeartRateRangeAlert(target: Measurement(value: low, unit: perMinute)...Measurement(value: high, unit: perMinute))
            guard CustomWorkout.supportsAlert(heartRate, activity: activity, location: location) else {
                throw VeyvoWatchError.stepUnsupported("heart rate alert")
            }
            return heartRate
        default:
            throw VeyvoWatchError.invalid("target \(target.type)")
        }
    }
}

/// Apple's workout preview ("add to watch") is a SwiftUI modifier; this transparent view hosts it.
@available(iOS 17.0, *)
struct VeyvoWorkoutPreviewHost: View {
    let plan: WorkoutPlan
    let onDismiss: () -> Void
    @State private var isPresented = false

    var body: some View {
        Color.clear
            .ignoresSafeArea()
            .contentShape(Rectangle())
            // Only reachable when the system sheet is not up: never leave an invisible overlay behind.
            .onTapGesture { onDismiss() }
            .workoutPreview(plan, isPresented: $isPresented)
            .onAppear {
                DispatchQueue.main.async { isPresented = true }
            }
            .onChange(of: isPresented) { _, presented in
                if !presented { onDismiss() }
            }
    }
}

/// One open preview: a clear full-screen UIHostingController over the web view.
/// Main thread only (every method; the plugin calls it from DispatchQueue.main).
@available(iOS 17.0, *)
final class VeyvoWorkoutPreviewSession {
    private var host: UIViewController?
    private var finished = false
    private var completion: ((Bool) -> Void)?

    /// `completion` runs exactly once, when nothing of the preview is left on screen: true after
    /// Apple's sheet was shown and closed, false when UIKit refused to present the host.
    func present(_ plan: WorkoutPlan, from presenter: UIViewController, completion: @escaping (Bool) -> Void) {
        self.completion = completion
        let root = VeyvoWorkoutPreviewHost(plan: plan, onDismiss: { [weak self] in self?.finish(shown: true) })
        let controller = UIHostingController(rootView: root)
        controller.view.backgroundColor = .clear
        controller.modalPresentationStyle = .overFullScreen
        host = controller
        presenter.present(controller, animated: false)
        // UIKit refuses a presentation silently (presenter busy or off screen) and then never calls back.
        DispatchQueue.main.async { [weak self] in
            if controller.presentingViewController == nil { self?.finish(shown: false) }
        }
    }

    private func finish(shown: Bool) {
        guard !finished else { return }
        finished = true
        close(attempt: 0, shown: shown)
    }

    /// Dismisses from the host's presenter: that removes the clear host and anything still above it.
    /// `host.dismiss` would only dismiss what the host presents (Apple's sheet, which SwiftUI may still
    /// be closing when isPresented turns false) and leave an invisible layer over the web view. UIKit
    /// drops a dismissal requested during a running transition, so wait for it first (up to 2 s), and
    /// never leave the JS call waiting.
    private func close(attempt: Int, shown: Bool) {
        guard let host = host, let presenter = host.presentingViewController else {
            complete(shown)
            return
        }
        let sheet = host.presentedViewController
        let moving = host.transitionCoordinator != nil || sheet?.transitionCoordinator != nil
            || host.isBeingPresented || host.isBeingDismissed
            || sheet?.isBeingPresented == true || sheet?.isBeingDismissed == true
        if moving && attempt < 40 {
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.05) { [weak self] in
                self?.close(attempt: attempt + 1, shown: shown)
            }
            return
        }
        presenter.dismiss(animated: false) { [weak self] in self?.complete(shown) }
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.0) { [weak self] in self?.complete(shown) }
    }

    private func complete(_ shown: Bool) {
        host = nil
        guard let done = completion else { return }
        completion = nil
        done(shown)
    }
}

/// WorkoutScheduler: the Workout app's list of scheduled workouts (only this app's own entries).
@available(iOS 17.0, *)
enum VeyvoWatchScheduler {
    static func authorize() async throws {
        let scheduler = WorkoutScheduler.shared
        var state = await scheduler.authorizationState
        if state == .notDetermined {
            state = await scheduler.requestAuthorization()
        }
        guard state == .authorized else { throw VeyvoWatchError.denied }
    }

    static func date(of components: DateComponents, calendar: Calendar) -> Date? {
        if let date = components.date { return date }
        return calendar.date(from: components)
    }

    /// Schedules `plan` on `day` at `hour`:00 (today after that hour: the next minute) and removes this plan and any other workout VEYVO
    /// scheduled for the same day first (VEYVO plans one session a day). Past entries are removed
    /// only when the scheduler is full: going over maxAllowedScheduledWorkoutCount can wipe them all.
    static func schedule(_ plan: WorkoutPlan, on day: VeyvoDay, hour: Int) async throws -> [String: Any] {
        try await authorize()
        let scheduler = WorkoutScheduler.shared
        let calendar = Calendar.autoupdatingCurrent
        guard let planned = day.date(hour: hour, calendar: calendar) else { throw VeyvoWatchError.date }
        let now = Date()
        let today = calendar.startOfDay(for: now)
        guard calendar.startOfDay(for: planned) >= today else { throw VeyvoWatchError.date }
        // Today after `hour`: a start time that has already passed may never show up on the watch, so
        // use the next minute instead (still the same day; just before midnight keeps the current time).
        let start: Date
        if planned < now {
            let soon = now.addingTimeInterval(60)
            start = calendar.isDate(soon, inSameDayAs: planned) ? soon : now
        } else {
            start = planned
        }
        let components = calendar.dateComponents([.calendar, .timeZone, .year, .month, .day, .hour, .minute], from: start)

        var replaced = 0
        let existing = await scheduler.scheduledWorkouts
        for item in existing {
            let sameDay = date(of: item.date, calendar: calendar).map { calendar.isDate($0, inSameDayAs: start) } ?? false
            if item.plan.id == plan.id || sameDay {
                await scheduler.remove(item.plan, at: item.date)
                replaced += 1
            }
        }
        var current = await scheduler.scheduledWorkouts
        let limit = WorkoutScheduler.maxAllowedScheduledWorkoutCount
        if current.count >= limit {
            for item in current {
                if let when = date(of: item.date, calendar: calendar), when < today {
                    await scheduler.remove(item.plan, at: item.date)
                }
            }
            current = await scheduler.scheduledWorkouts
            guard current.count < limit else { throw VeyvoWatchError.limit }
        }
        await scheduler.schedule(plan, at: components)
        return ["scheduled": true, "id": "\(plan.id)", "date": day.key, "replaced": replaced]
    }

    static func list() async -> [[String: Any]] {
        let calendar = Calendar.autoupdatingCurrent
        let dayFormat = VeyvoDayText.formatter("yyyy-MM-dd")
        let timeFormat = VeyvoDayText.formatter("HH:mm")
        let items = await WorkoutScheduler.shared.scheduledWorkouts
        return items.map { item in
            var row: [String: Any] = ["id": "\(item.plan.id)", "complete": item.complete]
            if let when = date(of: item.date, calendar: calendar) {
                row["date"] = dayFormat.string(from: when)
                row["time"] = timeFormat.string(from: when)
            }
            if case .custom(let workout) = item.plan.workout, let name = workout.displayName {
                row["name"] = name
            }
            return row
        }
    }

    static func clear() async -> Int {
        let count = await WorkoutScheduler.shared.scheduledWorkouts.count
        await WorkoutScheduler.shared.removeAllWorkouts()
        return count
    }
}

#endif

// MARK: - Capacitor plugin

@objc(VeyvoWorkoutKitPlugin)
public class VeyvoWorkoutKitPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "VeyvoWorkoutKitPlugin"
    public let jsName = "VeyvoWorkoutKit"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "isSupported", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "preview", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "schedule", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "listScheduled", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "clearScheduled", returnType: CAPPluginReturnPromise)
    ]

    /// The open preview (VeyvoWorkoutPreviewSession on iOS 17+), so a second tap cannot stack a sheet.
    /// Read and written on the main thread only.
    private var previewSession: AnyObject?

    @objc func isSupported(_ call: CAPPluginCall) {
        #if canImport(WorkoutKit)
        if #available(iOS 17.0, *) {
            call.resolve([
                "supported": true,
                "preview": true,
                "schedule": WorkoutScheduler.isSupported,
                "maxScheduled": WorkoutScheduler.maxAllowedScheduledWorkoutCount
            ])
            return
        }
        #endif
        call.resolve(["supported": false, "preview": false, "schedule": false, "reason": "ios_version"])
    }

    @objc func preview(_ call: CAPPluginCall) {
        #if canImport(WorkoutKit)
        if #available(iOS 17.0, *) {
            let plan: WorkoutPlan
            do {
                let request = try readRequest(call)
                plan = try VeyvoWorkoutBuilder.plan(from: request.workout, indoor: request.indoor, planId: request.planId)
            } catch {
                reject(call, error)
                return
            }
            DispatchQueue.main.async { [weak self] in
                guard let self = self else { return }
                if self.previewSession != nil {
                    self.reject(call, VeyvoWatchError.busy)
                    return
                }
                guard let presenter = self.topViewController() else {
                    self.reject(call, VeyvoWatchError.failed("no view controller to present from"))
                    return
                }
                let session = VeyvoWorkoutPreviewSession()
                self.previewSession = session
                session.present(plan, from: presenter) { [weak self] shown in
                    self?.previewSession = nil
                    if shown {
                        call.resolve(["shown": true])
                    } else {
                        call.reject("the workout preview could not be shown", "watch_failed")
                    }
                }
            }
            return
        }
        #endif
        reject(call, VeyvoWatchError.unsupported("Apple Watch workouts need iOS 17 or later"))
    }

    @objc func schedule(_ call: CAPPluginCall) {
        #if canImport(WorkoutKit)
        if #available(iOS 17.0, *) {
            guard WorkoutScheduler.isSupported else {
                reject(call, VeyvoWatchError.unsupported("WorkoutScheduler is not supported on this device"))
                return
            }
            let plan: WorkoutPlan
            guard let day = VeyvoDay(call.getString("date")) else {
                reject(call, VeyvoWatchError.date)
                return
            }
            let hour = min(max(call.getInt("hour") ?? 7, 0), 23)
            do {
                let request = try readRequest(call)
                plan = try VeyvoWorkoutBuilder.plan(from: request.workout, indoor: request.indoor, planId: request.planId)
            } catch {
                reject(call, error)
                return
            }
            Task {
                do {
                    let result = try await VeyvoWatchScheduler.schedule(plan, on: day, hour: hour)
                    call.resolve(result)
                } catch {
                    self.reject(call, error)
                }
            }
            return
        }
        #endif
        reject(call, VeyvoWatchError.unsupported("Apple Watch workouts need iOS 17 or later"))
    }

    @objc func listScheduled(_ call: CAPPluginCall) {
        #if canImport(WorkoutKit)
        if #available(iOS 17.0, *) {
            Task {
                let rows = await VeyvoWatchScheduler.list()
                call.resolve(["workouts": rows])
            }
            return
        }
        #endif
        call.resolve(["workouts": [[String: Any]]()])
    }

    @objc func clearScheduled(_ call: CAPPluginCall) {
        #if canImport(WorkoutKit)
        if #available(iOS 17.0, *) {
            Task {
                let removed = await VeyvoWatchScheduler.clear()
                call.resolve(["removed": removed])
            }
            return
        }
        #endif
        call.resolve(["removed": 0])
    }

    // MARK: helpers

    private func readRequest(_ call: CAPPluginCall) throws -> (workout: VeyvoWatchWorkout, indoor: Bool, planId: UUID?) {
        guard let json = call.getString("workoutJson"), let data = json.data(using: .utf8) else {
            throw VeyvoWatchError.invalid("workoutJson is missing")
        }
        let workout: VeyvoWatchWorkout
        do {
            workout = try JSONDecoder().decode(VeyvoWatchWorkout.self, from: data)
        } catch {
            throw VeyvoWatchError.invalid("workoutJson does not match the VEYVO workout model")
        }
        let planId = call.getString("planId").flatMap { UUID(uuidString: $0) }
        return (workout, call.getBool("indoor") ?? false, planId)
    }

    /// Main thread only. The topmost presented view controller that is not on its way out (UIKit
    /// refuses to present from a controller that is being dismissed).
    private func topViewController() -> UIViewController? {
        var top = bridge?.viewController
        while let presented = top?.presentedViewController, !presented.isBeingDismissed {
            top = presented
        }
        return top
    }

    private func reject(_ call: CAPPluginCall, _ error: Error) {
        if let watchError = error as? VeyvoWatchError {
            call.reject(watchError.message, watchError.code)
        } else {
            call.reject(error.localizedDescription, "watch_failed", error)
        }
    }
}
