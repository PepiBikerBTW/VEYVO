import Foundation
import Capacitor
import HealthKit

// VEYVO <- Apple Health (HealthKit), read only. VEYVO never writes to Health and never sends Health
// data off the device: the rows go to the web app, which stores them in its local journal.
//
// JS: Capacitor.Plugins.VeyvoHealth, wrapped by VeyvoPlatform.health (src/platform.js); the rows go
// to VeyvoStore.importHealthRuns (src/core/store.js).
//
//   isAvailable()                      -> { available }   HKHealthStore.isHealthDataAvailable()
//   requestAuthorization()             -> { requested }   read: workouts, running distance, heart rate
//   importRuns({ since: ISO, limit })  -> { runs: [Row] }  running workouts that started at or after since
//
//   Row = { healthId: HKWorkout UUID (upper case), startDate: ISO 8601 UTC, date: 'YYYY-MM-DD' and
//           startTime: 'HH:MM' (both local), distanceKm?, movingSeconds (HKWorkout.duration),
//           averageHeartrate?, maxHeartrate? (bpm), sourceName (the app that wrote the workout),
//           indoor? (HKMetadataKeyIndoorWorkout) }
//
// Distance: the workout's own statistics (iOS 16+) or totalDistance, else the sum of running distance
// samples during the workout. Heart rate: the workout's statistics (iOS 16+), else average and maximum
// of the heart-rate samples during the workout. iOS never tells an app that reading was denied: a
// denied permission simply returns no workouts.
//
// Error codes: health_unavailable, health_failed (platform.error.<code> texts).

@objc(VeyvoHealthPlugin)
public class VeyvoHealthPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "VeyvoHealthPlugin"
    public let jsName = "VeyvoHealth"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "isAvailable", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "requestAuthorization", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "importRuns", returnType: CAPPluginReturnPromise)
    ]

    private static let defaultDays: Double = 90
    private static let maxRows = 5000

    /// Created on first use, only where Health data exists (plugin calls arrive on Capacitor's serial queue).
    private var healthStore: HKHealthStore?

    private func store() -> HKHealthStore? {
        guard HKHealthStore.isHealthDataAvailable() else { return nil }
        if let existing = healthStore { return existing }
        let created = HKHealthStore()
        healthStore = created
        return created
    }

    private var readTypes: Set<HKObjectType> {
        var types: Set<HKObjectType> = [HKObjectType.workoutType()]
        if let distance = HKObjectType.quantityType(forIdentifier: .distanceWalkingRunning) { types.insert(distance) }
        if let heartRate = HKObjectType.quantityType(forIdentifier: .heartRate) { types.insert(heartRate) }
        return types
    }

    @objc func isAvailable(_ call: CAPPluginCall) {
        call.resolve(["available": HKHealthStore.isHealthDataAvailable()])
    }

    @objc func requestAuthorization(_ call: CAPPluginCall) {
        guard let store = store() else {
            call.reject("Health data is not available on this device", "health_unavailable")
            return
        }
        // Read only: nothing to share (write), so no NSHealthUpdateUsageDescription is needed.
        store.requestAuthorization(toShare: nil, read: readTypes) { success, error in
            if let error = error {
                call.reject(error.localizedDescription, "health_failed", error)
                return
            }
            call.resolve(["requested": success])
        }
    }

    @objc func importRuns(_ call: CAPPluginCall) {
        guard let store = store() else {
            call.reject("Health data is not available on this device", "health_unavailable")
            return
        }
        let since = VeyvoHealthPlugin.parseDate(call.getString("since")) ?? Date(timeIntervalSinceNow: -VeyvoHealthPlugin.defaultDays * 86_400)
        let limit = min(max(call.getInt("limit") ?? 1000, 1), VeyvoHealthPlugin.maxRows)
        let predicate = NSCompoundPredicate(andPredicateWithSubpredicates: [
            HKQuery.predicateForWorkouts(with: .running),
            HKQuery.predicateForSamples(withStart: since, end: nil, options: .strictStartDate)
        ])
        let sort = NSSortDescriptor(key: HKSampleSortIdentifierStartDate, ascending: true)
        let query = HKSampleQuery(sampleType: HKObjectType.workoutType(), predicate: predicate, limit: limit, sortDescriptors: [sort]) { [weak self] _, samples, error in
            if let error = error {
                call.reject(error.localizedDescription, "health_failed", error)
                return
            }
            guard let self = self else {
                call.reject("Apple Health import was interrupted", "health_failed")
                return
            }
            let workouts = (samples ?? []).compactMap { $0 as? HKWorkout }
            self.rows(for: workouts, store: store) { rows in
                call.resolve(["runs": rows])
            }
        }
        store.execute(query)
    }

    // MARK: rows

    private func rows(for workouts: [HKWorkout], store: HKHealthStore, completion: @escaping ([[String: Any]]) -> Void) {
        if workouts.isEmpty {
            completion([])
            return
        }
        let iso = ISO8601DateFormatter()
        let dayFormat = VeyvoHealthPlugin.localFormatter("yyyy-MM-dd")
        let timeFormat = VeyvoHealthPlugin.localFormatter("HH:mm")
        let group = DispatchGroup()
        let collector = VeyvoHealthRows(count: workouts.count)

        for (index, workout) in workouts.enumerated() {
            var row: [String: Any] = [
                "healthId": workout.uuid.uuidString,
                "startDate": iso.string(from: workout.startDate),
                "date": dayFormat.string(from: workout.startDate),
                "startTime": timeFormat.string(from: workout.startDate),
                "movingSeconds": workout.duration,
                "sourceName": workout.sourceRevision.source.name
            ]
            if let indoor = workout.metadata?[HKMetadataKeyIndoorWorkout] as? Bool {
                row["indoor"] = indoor
            }
            let base = row
            group.enter()
            distanceMeters(of: workout, store: store) { meters in
                self.heartRate(of: workout, store: store) { average, maximum in
                    var complete = base
                    if let meters = meters, meters > 0 { complete["distanceKm"] = meters / 1000.0 }
                    if let average = average { complete["averageHeartrate"] = average }
                    if let maximum = maximum { complete["maxHeartrate"] = maximum }
                    collector.set(complete, at: index)
                    group.leave()
                }
            }
        }
        group.notify(queue: DispatchQueue.global(qos: .userInitiated)) {
            completion(collector.all())
        }
    }

    private func distanceMeters(of workout: HKWorkout, store: HKHealthStore, completion: @escaping (Double?) -> Void) {
        guard let type = HKObjectType.quantityType(forIdentifier: .distanceWalkingRunning) else {
            completion(nil)
            return
        }
        if #available(iOS 16.0, *) {
            if let sum = workout.statistics(for: type)?.sumQuantity() {
                completion(sum.doubleValue(for: HKUnit.meter()))
                return
            }
        }
        if let total = workout.totalDistance {
            completion(total.doubleValue(for: HKUnit.meter()))
            return
        }
        let during = HKQuery.predicateForSamples(withStart: workout.startDate, end: workout.endDate, options: .strictStartDate)
        let query = HKStatisticsQuery(quantityType: type, quantitySamplePredicate: during, options: .cumulativeSum) { _, statistics, _ in
            completion(statistics?.sumQuantity()?.doubleValue(for: HKUnit.meter()))
        }
        store.execute(query)
    }

    private func heartRate(of workout: HKWorkout, store: HKHealthStore, completion: @escaping (Double?, Double?) -> Void) {
        guard let type = HKObjectType.quantityType(forIdentifier: .heartRate) else {
            completion(nil, nil)
            return
        }
        let bpm = HKUnit.count().unitDivided(by: HKUnit.minute())
        if #available(iOS 16.0, *) {
            if let statistics = workout.statistics(for: type), let average = statistics.averageQuantity() {
                completion(average.doubleValue(for: bpm), statistics.maximumQuantity()?.doubleValue(for: bpm))
                return
            }
        }
        let during = HKQuery.predicateForSamples(withStart: workout.startDate, end: workout.endDate, options: .strictStartDate)
        let query = HKStatisticsQuery(quantityType: type, quantitySamplePredicate: during, options: [.discreteAverage, .discreteMax]) { _, statistics, _ in
            completion(statistics?.averageQuantity()?.doubleValue(for: bpm), statistics?.maximumQuantity()?.doubleValue(for: bpm))
        }
        store.execute(query)
    }

    // MARK: dates

    private static func localFormatter(_ format: String) -> DateFormatter {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.calendar = Calendar(identifier: .gregorian)
        formatter.timeZone = TimeZone.current
        formatter.dateFormat = format
        return formatter
    }

    /// '2026-08-29T08:00:00.000Z' (JavaScript toISOString) or without fractional seconds.
    private static func parseDate(_ text: String?) -> Date? {
        guard let text = text, !text.isEmpty else { return nil }
        let withFraction = ISO8601DateFormatter()
        withFraction.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let date = withFraction.date(from: text) { return date }
        return ISO8601DateFormatter().date(from: text)
    }
}

/// Rows filled in from several HealthKit callbacks at once (one per workout), kept in workout order.
/// Every access goes through `lock`, hence the unchecked Sendable (HealthKit calls back on its own queues).
final class VeyvoHealthRows: @unchecked Sendable {
    private let lock = NSLock()
    private var rows: [[String: Any]?]

    init(count: Int) {
        rows = Array(repeating: nil, count: count)
    }

    func set(_ row: [String: Any], at index: Int) {
        lock.lock()
        rows[index] = row
        lock.unlock()
    }

    func all() -> [[String: Any]] {
        lock.lock()
        defer { lock.unlock() }
        return rows.compactMap { $0 }
    }
}
