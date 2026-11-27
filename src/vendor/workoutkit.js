/*! @bibixx/workoutkit 0.2.0 — vendored for VEYVO as a classic script (globalThis.VeyvoWorkoutKit).
MIT License

Copyright (c) 2026 Bartosz Legięć

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.
*/
(function(){
// src/schema.ts
var ActivityType = {
  americanFootball: 1,
  archery: 2,
  australianFootball: 3,
  badminton: 4,
  baseball: 5,
  basketball: 6,
  bowling: 7,
  boxing: 8,
  climbing: 9,
  cricket: 10,
  crossTraining: 11,
  curling: 12,
  cycling: 13,
  dance: 14,
  elliptical: 16,
  equestrianSports: 17,
  fencing: 18,
  fishing: 19,
  functionalStrengthTraining: 20,
  golf: 21,
  gymnastics: 22,
  handball: 23,
  hiking: 24,
  hockey: 25,
  hunting: 26,
  lacrosse: 27,
  martialArts: 28,
  mindAndBody: 29,
  paddleSports: 31,
  play: 32,
  preparationAndRecovery: 33,
  racquetball: 34,
  rowing: 35,
  rugby: 36,
  running: 37,
  sailing: 38,
  skatingSports: 39,
  snowSports: 40,
  soccer: 41,
  softball: 42,
  squash: 43,
  stairClimbing: 44,
  surfingSports: 45,
  swimming: 46,
  tableTennis: 47,
  tennis: 48,
  trackAndField: 49,
  traditionalStrengthTraining: 50,
  volleyball: 51,
  walking: 52,
  waterFitness: 53,
  waterPolo: 54,
  waterSports: 55,
  wrestling: 56,
  yoga: 57,
  barre: 58,
  coreTraining: 59,
  crossCountrySkiing: 60,
  downhillSkiing: 61,
  flexibility: 62,
  highIntensityIntervalTraining: 63,
  jumpRope: 64,
  kickboxing: 65,
  pilates: 66,
  snowboarding: 67,
  stairs: 68,
  stepTraining: 69,
  wheelchairWalkPace: 70,
  wheelchairRunPace: 71,
  taiChi: 72,
  mixedCardio: 73,
  handCycling: 74,
  discSports: 75,
  fitnessGaming: 76,
  cardioDance: 77,
  socialDance: 78,
  pickleball: 79,
  cooldown: 80,
  swimBikeRun: 82,
  transition: 83,
  underwaterDiving: 84,
  other: 3e3
};

// src/quantities.ts
var Distance = class _Distance {
  constructor(value, unit) {
    this.value = value;
    this.unit = unit;
  }
  value;
  unit;
  static fromJson(json) {
    return new _Distance(json.value, json.unit);
  }
  toJSON() {
    return { value: this.value, unit: this.unit };
  }
};
var Duration = class _Duration {
  constructor(value, unit) {
    this.value = value;
    this.unit = unit;
  }
  value;
  unit;
  static fromJson(json) {
    return new _Duration(json.value, json.unit);
  }
  toJSON() {
    return { value: this.value, unit: this.unit };
  }
};
var Energy = class _Energy {
  constructor(value, unit) {
    this.value = value;
    this.unit = unit;
  }
  value;
  unit;
  static fromJson(json) {
    return new _Energy(json.value, json.unit);
  }
  toJSON() {
    return { value: this.value, unit: this.unit };
  }
};
var Power = class _Power {
  constructor(value, unit) {
    this.value = value;
    this.unit = unit;
  }
  value;
  unit;
  static fromJson(json) {
    return new _Power(json.value, json.unit);
  }
  toJSON() {
    return { value: this.value, unit: this.unit };
  }
};
var HeartRate = class _HeartRate {
  constructor(value, unit = "beatsPerMinute") {
    this.value = value;
    this.unit = unit;
  }
  value;
  unit;
  static fromJson(json) {
    return new _HeartRate(json.value, json.unit);
  }
  toJSON() {
    return { value: this.value, unit: this.unit };
  }
};
var Cadence = class _Cadence {
  constructor(value, unit = "countPerMinute") {
    this.value = value;
    this.unit = unit;
  }
  value;
  unit;
  static fromJson(json) {
    return new _Cadence(json.value, json.unit);
  }
  toJSON() {
    return { value: this.value, unit: this.unit };
  }
};
var Speed = class _Speed {
  constructor(distance, time) {
    this.distance = distance;
    this.time = time;
  }
  distance;
  time;
  static fromJson(json) {
    return new _Speed(Distance.fromJson(json.distance), Duration.fromJson(json.time));
  }
  toJSON() {
    return { distance: this.distance.toJSON(), time: this.time.toJSON() };
  }
};

// src/classes.ts
var Goal = class {
  static fromJson(json) {
    switch (json.type) {
      case "open":
        return new OpenGoal();
      case "time":
        return new TimeGoal(Duration.fromJson(json.time));
      case "distance":
        return new DistanceGoal(Distance.fromJson(json.distance));
      case "energy":
        return new EnergyGoal(Energy.fromJson(json.energy));
      case "poolSwimDistanceWithTime":
        return new PoolSwimDistanceWithTimeGoal(
          Distance.fromJson(json.poolSwimDistanceWithTime.distance),
          Duration.fromJson(json.poolSwimDistanceWithTime.time)
        );
    }
  }
};
var OpenGoal = class extends Goal {
  toJSON() {
    return { type: "open" };
  }
};
var TimeGoal = class extends Goal {
  constructor(time) {
    super();
    this.time = time;
  }
  time;
  toJSON() {
    return { type: "time", time: this.time.toJSON() };
  }
};
var DistanceGoal = class extends Goal {
  constructor(distance) {
    super();
    this.distance = distance;
  }
  distance;
  toJSON() {
    return { type: "distance", distance: this.distance.toJSON() };
  }
};
var EnergyGoal = class extends Goal {
  constructor(energy) {
    super();
    this.energy = energy;
  }
  energy;
  toJSON() {
    return { type: "energy", energy: this.energy.toJSON() };
  }
};
var PoolSwimDistanceWithTimeGoal = class extends Goal {
  constructor(distance, time) {
    super();
    this.distance = distance;
    this.time = time;
  }
  distance;
  time;
  toJSON() {
    return {
      type: "poolSwimDistanceWithTime",
      poolSwimDistanceWithTime: {
        distance: this.distance.toJSON(),
        time: this.time.toJSON()
      }
    };
  }
};
var Alert = class {
  static fromJson(json) {
    switch (json.type) {
      case "heartRateZone":
        return new HeartRateZoneAlert(json.zone);
      case "heartRateRange":
        return new HeartRateRangeAlert(HeartRate.fromJson(json.min), HeartRate.fromJson(json.max));
      case "powerZone":
        return new PowerZoneAlert(json.zone);
      case "powerRange":
        return new PowerRangeAlert(Power.fromJson(json.min), Power.fromJson(json.max), json.metric);
      case "powerThreshold":
        return new PowerThresholdAlert(Power.fromJson(json.threshold), json.metric);
      case "speedRange":
        return new SpeedRangeAlert(Speed.fromJson(json.min), Speed.fromJson(json.max), json.metric);
      case "speedThreshold":
        return new SpeedThresholdAlert(Speed.fromJson(json.threshold), json.metric);
      case "cadenceThreshold":
        return new CadenceThresholdAlert(Cadence.fromJson(json.threshold));
      case "cadenceRange":
        return new CadenceRangeAlert(Cadence.fromJson(json.min), Cadence.fromJson(json.max));
    }
  }
};
var HeartRateZoneAlert = class extends Alert {
  constructor(zone) {
    super();
    this.zone = zone;
  }
  zone;
  toJSON() {
    return { type: "heartRateZone", zone: this.zone };
  }
};
var HeartRateRangeAlert = class extends Alert {
  constructor(min, max) {
    super();
    this.min = min;
    this.max = max;
  }
  min;
  max;
  toJSON() {
    return {
      type: "heartRateRange",
      min: this.min.toJSON(),
      max: this.max.toJSON()
    };
  }
};
var PowerZoneAlert = class extends Alert {
  constructor(zone) {
    super();
    this.zone = zone;
  }
  zone;
  toJSON() {
    return { type: "powerZone", zone: this.zone };
  }
};
var PowerRangeAlert = class extends Alert {
  constructor(min, max, metric) {
    super();
    this.min = min;
    this.max = max;
    this.metric = metric;
  }
  min;
  max;
  metric;
  toJSON() {
    const out = {
      type: "powerRange",
      min: this.min.toJSON(),
      max: this.max.toJSON()
    };
    if (this.metric) out.metric = this.metric;
    return out;
  }
};
var PowerThresholdAlert = class extends Alert {
  constructor(threshold, metric) {
    super();
    this.threshold = threshold;
    this.metric = metric;
  }
  threshold;
  metric;
  toJSON() {
    const out = {
      type: "powerThreshold",
      threshold: this.threshold.toJSON()
    };
    if (this.metric) out.metric = this.metric;
    return out;
  }
};
var SpeedRangeAlert = class extends Alert {
  constructor(min, max, metric) {
    super();
    this.min = min;
    this.max = max;
    this.metric = metric;
  }
  min;
  max;
  metric;
  toJSON() {
    const out = {
      type: "speedRange",
      min: this.min.toJSON(),
      max: this.max.toJSON()
    };
    if (this.metric) out.metric = this.metric;
    return out;
  }
};
var SpeedThresholdAlert = class extends Alert {
  constructor(threshold, metric) {
    super();
    this.threshold = threshold;
    this.metric = metric;
  }
  threshold;
  metric;
  toJSON() {
    const out = {
      type: "speedThreshold",
      threshold: this.threshold.toJSON()
    };
    if (this.metric) out.metric = this.metric;
    return out;
  }
};
var CadenceThresholdAlert = class extends Alert {
  constructor(threshold) {
    super();
    this.threshold = threshold;
  }
  threshold;
  toJSON() {
    return { type: "cadenceThreshold", threshold: this.threshold.toJSON() };
  }
};
var CadenceRangeAlert = class extends Alert {
  constructor(min, max) {
    super();
    this.min = min;
    this.max = max;
  }
  min;
  max;
  toJSON() {
    return {
      type: "cadenceRange",
      min: this.min.toJSON(),
      max: this.max.toJSON()
    };
  }
};
var Step = class _Step {
  displayName;
  goal;
  alert;
  constructor(goal, displayName, alert) {
    this.goal = goal;
    this.displayName = displayName;
    this.alert = alert;
  }
  static fromJson(json) {
    return new _Step(
      Goal.fromJson(json.goal),
      json.displayName,
      json.alert ? Alert.fromJson(json.alert) : void 0
    );
  }
  toJSON() {
    const out = { goal: this.goal.toJSON() };
    if (this.displayName !== void 0) out.displayName = this.displayName;
    if (this.alert) out.alert = this.alert.toJSON();
    return out;
  }
};
var IntervalStep = class _IntervalStep {
  purpose;
  step;
  constructor(purpose, step) {
    this.purpose = purpose;
    this.step = step;
  }
  static fromJson(json) {
    return new _IntervalStep(json.purpose, Step.fromJson(json.step));
  }
  toJSON() {
    return { purpose: this.purpose, step: this.step.toJSON() };
  }
};
var IntervalBlock = class _IntervalBlock {
  iterations;
  steps = [];
  constructor(iterations) {
    this.iterations = iterations;
  }
  addStep(purpose, goal, displayName, alert) {
    const s = new IntervalStep(purpose, new Step(goal, displayName, alert));
    this.steps.push(s);
    return s;
  }
  static fromJson(json) {
    const b = new _IntervalBlock(json.iterations);
    b.steps = json.steps.map((s) => IntervalStep.fromJson(s));
    return b;
  }
  toJSON() {
    return {
      iterations: this.iterations,
      steps: this.steps.map((s) => s.toJSON())
    };
  }
};
var CustomWorkout = class _CustomWorkout {
  activity;
  location;
  displayName;
  warmup;
  blocks = [];
  cooldown;
  constructor(init) {
    this.activity = init.activity;
    this.location = init.location;
    this.displayName = init.displayName;
  }
  addBlock(iterations) {
    const b = new IntervalBlock(iterations);
    this.blocks.push(b);
    return b;
  }
  static fromJson(json) {
    const w = new _CustomWorkout({
      activity: json.activity,
      location: json.location,
      displayName: json.displayName
    });
    if (json.warmup) w.warmup = Step.fromJson(json.warmup);
    w.blocks = json.blocks.map((b) => IntervalBlock.fromJson(b));
    if (json.cooldown) w.cooldown = Step.fromJson(json.cooldown);
    return w;
  }
  toJSON() {
    const out = {
      activity: this.activity,
      location: this.location,
      blocks: this.blocks.map((b) => b.toJSON())
    };
    if (this.displayName !== void 0) out.displayName = this.displayName;
    if (this.warmup) out.warmup = this.warmup.toJSON();
    if (this.cooldown) out.cooldown = this.cooldown.toJSON();
    return out;
  }
};
var SingleGoalWorkout = class _SingleGoalWorkout {
  activity;
  location;
  swimmingLocation;
  goal;
  constructor(init) {
    this.activity = init.activity;
    this.location = init.location;
    this.swimmingLocation = init.swimmingLocation;
    this.goal = init.goal;
  }
  static fromJson(json) {
    return new _SingleGoalWorkout({
      activity: json.activity,
      location: json.location,
      swimmingLocation: json.swimmingLocation,
      goal: Goal.fromJson(json.goal)
    });
  }
  toJSON() {
    const out = {
      activity: this.activity,
      location: this.location,
      goal: this.goal.toJSON()
    };
    if (this.swimmingLocation !== void 0) {
      out.swimmingLocation = this.swimmingLocation;
    }
    return out;
  }
};
var PacerWorkout = class _PacerWorkout {
  activity;
  location;
  distance;
  time;
  constructor(init) {
    this.activity = init.activity;
    this.location = init.location;
    this.distance = init.distance;
    this.time = init.time;
  }
  static fromJson(json) {
    return new _PacerWorkout({
      activity: json.activity,
      location: json.location,
      distance: Distance.fromJson(json.distance),
      time: Duration.fromJson(json.time)
    });
  }
  toJSON() {
    return {
      activity: this.activity,
      location: this.location,
      distance: this.distance.toJSON(),
      time: this.time.toJSON()
    };
  }
};
var SbrActivity = class {
  static fromJson(json) {
    switch (json.kind) {
      case "swimming":
        return new SwimmingActivity({ swimmingLocation: json.swimmingLocation });
      case "cycling":
        return new CyclingActivity({ location: json.location });
      case "running":
        return new RunningActivity({ location: json.location });
    }
  }
};
var SwimmingActivity = class extends SbrActivity {
  swimmingLocation;
  constructor(init) {
    super();
    this.swimmingLocation = init?.swimmingLocation;
  }
  toJSON() {
    const out = { kind: "swimming" };
    if (this.swimmingLocation !== void 0) {
      out.swimmingLocation = this.swimmingLocation;
    }
    return out;
  }
};
var CyclingActivity = class extends SbrActivity {
  location;
  constructor(init) {
    super();
    this.location = init?.location;
  }
  toJSON() {
    const out = { kind: "cycling" };
    if (this.location !== void 0) out.location = this.location;
    return out;
  }
};
var RunningActivity = class extends SbrActivity {
  location;
  constructor(init) {
    super();
    this.location = init?.location;
  }
  toJSON() {
    const out = { kind: "running" };
    if (this.location !== void 0) out.location = this.location;
    return out;
  }
};
var SwimBikeRunWorkout = class _SwimBikeRunWorkout {
  displayName;
  activities = [];
  constructor(init) {
    this.displayName = init?.displayName;
    if (init?.activities) this.activities = init.activities;
  }
  add(activity) {
    this.activities.push(activity);
    return this;
  }
  static fromJson(json) {
    const w = new _SwimBikeRunWorkout({ displayName: json.displayName });
    w.activities = json.activities.map((a) => SbrActivity.fromJson(a));
    return w;
  }
  toJSON() {
    const out = {
      activities: this.activities.map((a) => a.toJSON())
    };
    if (this.displayName !== void 0) out.displayName = this.displayName;
    return out;
  }
};
var WorkoutPlan = class _WorkoutPlan {
  referenceId;
  custom;
  goal;
  pacer;
  swimBikeRun;
  constructor(init) {
    this.referenceId = init.referenceId;
  }
  clearWorkout() {
    this.custom = void 0;
    this.goal = void 0;
    this.pacer = void 0;
    this.swimBikeRun = void 0;
  }
  asCustom(init) {
    this.clearWorkout();
    this.custom = new CustomWorkout(init);
    return this.custom;
  }
  asGoal(init) {
    this.clearWorkout();
    this.goal = new SingleGoalWorkout(init);
    return this.goal;
  }
  asPacer(init) {
    this.clearWorkout();
    this.pacer = new PacerWorkout(init);
    return this.pacer;
  }
  asSwimBikeRun(init) {
    this.clearWorkout();
    this.swimBikeRun = new SwimBikeRunWorkout(init);
    return this.swimBikeRun;
  }
  static fromJson(json) {
    const p = new _WorkoutPlan({ referenceId: json.referenceId });
    if (json.custom) p.custom = CustomWorkout.fromJson(json.custom);
    if (json.goal) p.goal = SingleGoalWorkout.fromJson(json.goal);
    if (json.pacer) p.pacer = PacerWorkout.fromJson(json.pacer);
    if (json.swimBikeRun) p.swimBikeRun = SwimBikeRunWorkout.fromJson(json.swimBikeRun);
    return p;
  }
  toJSON() {
    const out = { referenceId: this.referenceId };
    if (this.custom) out.custom = this.custom.toJSON();
    if (this.goal) out.goal = this.goal.toJSON();
    if (this.pacer) out.pacer = this.pacer.toJSON();
    if (this.swimBikeRun) out.swimBikeRun = this.swimBikeRun.toJSON();
    return out;
  }
};


//# sourceMappingURL=index.js.map
//# sourceMappingURL=index.js.map
Object.assign(globalThis.VeyvoWorkoutKit ||= {}, { ActivityType, Alert, Cadence, CadenceRangeAlert, CadenceThresholdAlert, CustomWorkout, CyclingActivity, Distance, DistanceGoal, Duration, Energy, EnergyGoal, Goal, HeartRate, HeartRateRangeAlert, HeartRateZoneAlert, IntervalBlock, IntervalStep, OpenGoal, PacerWorkout, PoolSwimDistanceWithTimeGoal, Power, PowerRangeAlert, PowerThresholdAlert, PowerZoneAlert, RunningActivity, SbrActivity, SingleGoalWorkout, Speed, SpeedRangeAlert, SpeedThresholdAlert, Step, SwimBikeRunWorkout, SwimmingActivity, TimeGoal, WorkoutPlan });
})();
(function(){
// src/wire.ts
var WIRE_VARINT = 0;
var WIRE_I64 = 1;
var WIRE_LEN = 2;
var Writer = class _Writer {
  chunks = [];
  len = 0;
  push(bytes) {
    this.chunks.push(bytes);
    this.len += bytes.length;
  }
  tag(field, wire) {
    this.varint(field << 3 | wire);
  }
  varint(value) {
    let v = typeof value === "bigint" ? value : BigInt(value);
    const out = [];
    while (v >= 0x80n) {
      out.push(Number(v & 0x7fn) | 128);
      v >>= 7n;
    }
    out.push(Number(v));
    this.push(new Uint8Array(out));
  }
  /** varint field, omitted when value == 0 (proto3 default). */
  uint32(field, value) {
    if (value === 0) return;
    this.tag(field, WIRE_VARINT);
    this.varint(value);
  }
  /** uint32 but always emitted (for enums where 0 is still a valid value to serialize). */
  uint32Required(field, value) {
    this.tag(field, WIRE_VARINT);
    this.varint(value);
  }
  double(field, value) {
    if (value === 0) return;
    this.tag(field, WIRE_I64);
    const buf = new ArrayBuffer(8);
    new DataView(buf).setFloat64(0, value, true);
    this.push(new Uint8Array(buf));
  }
  /** double without default-skip (for message fields where 0.0 is meaningful). */
  doubleRequired(field, value) {
    this.tag(field, WIRE_I64);
    const buf = new ArrayBuffer(8);
    new DataView(buf).setFloat64(0, value, true);
    this.push(new Uint8Array(buf));
  }
  string(field, value) {
    if (value == null || value.length === 0) return;
    this.tag(field, WIRE_LEN);
    const bytes = new TextEncoder().encode(value);
    this.varint(bytes.length);
    this.push(bytes);
  }
  /** Nested length-delimited message, built via a sub-writer. */
  message(field, build) {
    const sub = new _Writer();
    build(sub);
    const bytes = sub.finish();
    this.tag(field, WIRE_LEN);
    this.varint(bytes.length);
    this.push(bytes);
  }
  /** Like `message`, but omits the field when the sub-message has no bytes. */
  messageOptional(field, build) {
    const sub = new _Writer();
    build(sub);
    const bytes = sub.finish();
    if (bytes.length === 0) return;
    this.tag(field, WIRE_LEN);
    this.varint(bytes.length);
    this.push(bytes);
  }
  finish() {
    const out = new Uint8Array(this.len);
    let off = 0;
    for (const c of this.chunks) {
      out.set(c, off);
      off += c.length;
    }
    return out;
  }
};

// src/schema.ts
var ActivityType = {
  americanFootball: 1,
  archery: 2,
  australianFootball: 3,
  badminton: 4,
  baseball: 5,
  basketball: 6,
  bowling: 7,
  boxing: 8,
  climbing: 9,
  cricket: 10,
  crossTraining: 11,
  curling: 12,
  cycling: 13,
  dance: 14,
  elliptical: 16,
  equestrianSports: 17,
  fencing: 18,
  fishing: 19,
  functionalStrengthTraining: 20,
  golf: 21,
  gymnastics: 22,
  handball: 23,
  hiking: 24,
  hockey: 25,
  hunting: 26,
  lacrosse: 27,
  martialArts: 28,
  mindAndBody: 29,
  paddleSports: 31,
  play: 32,
  preparationAndRecovery: 33,
  racquetball: 34,
  rowing: 35,
  rugby: 36,
  running: 37,
  sailing: 38,
  skatingSports: 39,
  snowSports: 40,
  soccer: 41,
  softball: 42,
  squash: 43,
  stairClimbing: 44,
  surfingSports: 45,
  swimming: 46,
  tableTennis: 47,
  tennis: 48,
  trackAndField: 49,
  traditionalStrengthTraining: 50,
  volleyball: 51,
  walking: 52,
  waterFitness: 53,
  waterPolo: 54,
  waterSports: 55,
  wrestling: 56,
  yoga: 57,
  barre: 58,
  coreTraining: 59,
  crossCountrySkiing: 60,
  downhillSkiing: 61,
  flexibility: 62,
  highIntensityIntervalTraining: 63,
  jumpRope: 64,
  kickboxing: 65,
  pilates: 66,
  snowboarding: 67,
  stairs: 68,
  stepTraining: 69,
  wheelchairWalkPace: 70,
  wheelchairRunPace: 71,
  taiChi: 72,
  mixedCardio: 73,
  handCycling: 74,
  discSports: 75,
  fitnessGaming: 76,
  cardioDance: 77,
  socialDance: 78,
  pickleball: 79,
  cooldown: 80,
  swimBikeRun: 82,
  transition: 83,
  underwaterDiving: 84,
  other: 3e3
};

// src/encode.ts
var PLAN_FIELD = {
  goal: 10,
  custom: 11,
  pacer: 13,
  swimBikeRun: 14
};
var LOCATION_PROTO = {
  unknown: 0,
  indoor: 2,
  outdoor: 3
};
var SWIM_LOCATION_PROTO = {
  unknown: 0,
  pool: 1,
  openWater: 2
};
var PURPOSE_PROTO = { work: 1, recovery: 2 };
var GOAL_TYPE_PROTO = {
  open: 4,
  time: 1,
  energy: 2,
  distance: 3,
  poolSwimDistanceWithTime: 5
};
var LENGTH_UNIT_PROTO = {
  meters: 1,
  kilometers: 2,
  feet: 3,
  yards: 4,
  miles: 5
};
var DURATION_UNIT_PROTO = {
  seconds: 1,
  minutes: 2,
  hours: 3
};
var ENERGY_UNIT_PROTO = {
  kilocalories: 1,
  kilojoules: 2
};
var GOAL_VALUE_FIELD = {
  time: 2,
  energy: 3,
  distance: 4,
  poolSwimDistanceWithTime: 5
};
function writeQuantity(w, unit, value) {
  w.uint32Required(1, unit);
  w.doubleRequired(2, value);
}
function writeLengthQuantity(w, q) {
  writeQuantity(w, LENGTH_UNIT_PROTO[q.unit], q.value);
}
function writeDurationQuantity(w, q) {
  writeQuantity(w, DURATION_UNIT_PROTO[q.unit], q.value);
}
function writeEnergyQuantity(w, q) {
  writeQuantity(w, ENERGY_UNIT_PROTO[q.unit], q.value);
}
function writeGoal(w, g) {
  w.uint32Required(1, GOAL_TYPE_PROTO[g.type]);
  switch (g.type) {
    case "open":
      return;
    case "time":
      w.message(GOAL_VALUE_FIELD.time, (sub) => writeDurationQuantity(sub, g.time));
      return;
    case "distance":
      w.message(GOAL_VALUE_FIELD.distance, (sub) => writeLengthQuantity(sub, g.distance));
      return;
    case "energy":
      w.message(GOAL_VALUE_FIELD.energy, (sub) => writeEnergyQuantity(sub, g.energy));
      return;
    case "poolSwimDistanceWithTime":
      w.message(GOAL_VALUE_FIELD.poolSwimDistanceWithTime, (sub) => {
        const { distance, time } = g.poolSwimDistanceWithTime;
        sub.message(1, (d) => writeLengthQuantity(d, distance));
        sub.message(2, (t) => writeDurationQuantity(t, time));
      });
      return;
  }
}
var ALERT_TARGET_TYPE = {
  averageSpeed: 1,
  currentSpeed: 2,
  currentCadence: 3,
  currentPower: 4,
  currentHeartRate: 5,
  averagePower: 6
};
var ALERT_TARGET_KIND = {
  value: 1,
  range: 2,
  zone: 3
};
var WORKOUT_ALERT_FIELD = {
  speed: 4,
  cadence: 5,
  power: 6,
  heartRate: 7
};
var POWER_UNIT_PROTO = {
  watts: 1,
  kilowatts: 2
};
function powerTargetType(metric) {
  return metric === "average" ? ALERT_TARGET_TYPE.averagePower : ALERT_TARGET_TYPE.currentPower;
}
function speedTargetType(metric) {
  return metric === "average" ? ALERT_TARGET_TYPE.averageSpeed : ALERT_TARGET_TYPE.currentSpeed;
}
function writePowerValue(w, p) {
  w.uint32Required(1, POWER_UNIT_PROTO[p.unit]);
  w.doubleRequired(2, p.value);
}
function writeHeartRateValue(w, hr) {
  w.doubleRequired(1, hr.value);
}
function writeSpeedValue(w, s) {
  w.message(1, (d) => writeLengthQuantity(d, s.distance));
  w.message(2, (t) => writeDurationQuantity(t, s.time));
}
function writeCadenceValue(w, c) {
  w.uint32Required(1, Math.round(c.value));
  w.message(2, (d) => writeDurationQuantity(d, { value: 1, unit: "minutes" }));
}
function writeAlert(w, a) {
  switch (a.type) {
    case "heartRateZone":
      w.uint32Required(1, ALERT_TARGET_TYPE.currentHeartRate);
      w.uint32Required(2, ALERT_TARGET_KIND.zone);
      w.message(WORKOUT_ALERT_FIELD.heartRate, (sub) => {
        sub.message(1, (zt) => zt.uint32Required(1, a.zone));
      });
      return;
    case "heartRateRange":
      w.uint32Required(1, ALERT_TARGET_TYPE.currentHeartRate);
      w.uint32Required(2, ALERT_TARGET_KIND.range);
      w.message(WORKOUT_ALERT_FIELD.heartRate, (sub) => {
        sub.message(2, (range) => {
          range.message(1, (m) => writeHeartRateValue(m, a.min));
          range.message(2, (m) => writeHeartRateValue(m, a.max));
        });
      });
      return;
    case "powerZone":
      w.uint32Required(1, ALERT_TARGET_TYPE.currentPower);
      w.uint32Required(2, ALERT_TARGET_KIND.zone);
      w.message(WORKOUT_ALERT_FIELD.power, (sub) => {
        sub.message(3, (zt) => zt.uint32Required(1, a.zone));
      });
      return;
    case "powerRange":
      w.uint32Required(1, powerTargetType(a.metric));
      w.uint32Required(2, ALERT_TARGET_KIND.range);
      w.message(WORKOUT_ALERT_FIELD.power, (sub) => {
        sub.message(2, (range) => {
          range.message(1, (m) => writePowerValue(m, a.min));
          range.message(2, (m) => writePowerValue(m, a.max));
        });
      });
      return;
    case "powerThreshold":
      w.uint32Required(1, powerTargetType(a.metric));
      w.uint32Required(2, ALERT_TARGET_KIND.value);
      w.message(WORKOUT_ALERT_FIELD.power, (sub) => {
        sub.message(1, (target) => writePowerValue(target, a.threshold));
      });
      return;
    case "speedRange":
      w.uint32Required(1, speedTargetType(a.metric));
      w.uint32Required(2, ALERT_TARGET_KIND.range);
      w.message(WORKOUT_ALERT_FIELD.speed, (sub) => {
        sub.message(2, (range) => {
          range.message(1, (m) => writeSpeedValue(m, a.min));
          range.message(2, (m) => writeSpeedValue(m, a.max));
        });
      });
      return;
    case "speedThreshold":
      w.uint32Required(1, speedTargetType(a.metric));
      w.uint32Required(2, ALERT_TARGET_KIND.value);
      w.message(WORKOUT_ALERT_FIELD.speed, (sub) => {
        sub.message(1, (target) => writeSpeedValue(target, a.threshold));
      });
      return;
    case "cadenceThreshold":
      w.uint32Required(1, ALERT_TARGET_TYPE.currentCadence);
      w.uint32Required(2, ALERT_TARGET_KIND.value);
      w.message(WORKOUT_ALERT_FIELD.cadence, (sub) => {
        sub.message(1, (target) => writeCadenceValue(target, a.threshold));
      });
      return;
    case "cadenceRange":
      w.uint32Required(1, ALERT_TARGET_TYPE.currentCadence);
      w.uint32Required(2, ALERT_TARGET_KIND.range);
      w.message(WORKOUT_ALERT_FIELD.cadence, (sub) => {
        sub.message(2, (range) => {
          range.message(1, (m) => writeCadenceValue(m, a.min));
          range.message(2, (m) => writeCadenceValue(m, a.max));
        });
      });
      return;
  }
}
function writeStep(w, s) {
  w.message(1, (sub) => writeGoal(sub, s.goal));
  if (s.alert) w.message(2, (sub) => writeAlert(sub, s.alert));
  w.string(3, s.displayName);
}
function writeIntervalStep(w, is) {
  w.uint32Required(1, PURPOSE_PROTO[is.purpose]);
  w.message(2, (sub) => writeStep(sub, is.step));
}
function writeBlock(w, b) {
  for (const step of b.steps) {
    w.message(1, (sub) => writeIntervalStep(sub, step));
  }
  w.uint32(2, b.iterations);
}
function writeCustomWorkout(w, c) {
  w.uint32(1, ActivityType[c.activity]);
  w.uint32(2, LOCATION_PROTO[c.location]);
  w.string(3, c.displayName);
  if (c.warmup) w.message(4, (sub) => writeStep(sub, c.warmup));
  for (const b of c.blocks) w.message(5, (sub) => writeBlock(sub, b));
  if (c.cooldown) w.message(6, (sub) => writeStep(sub, c.cooldown));
}
function writeSingleGoalWorkout(w, g) {
  w.uint32(1, ActivityType[g.activity]);
  w.uint32(2, LOCATION_PROTO[g.location]);
  w.uint32(3, SWIM_LOCATION_PROTO[g.swimmingLocation ?? "unknown"]);
  w.message(4, (sub) => writeGoal(sub, g.goal));
}
function writePacerWorkout(w, p) {
  w.uint32(1, ActivityType[p.activity]);
  w.uint32(2, LOCATION_PROTO[p.location]);
  w.message(3, (sub) => writeLengthQuantity(sub, p.distance));
  w.message(4, (sub) => writeDurationQuantity(sub, p.time));
}
function writeSbrActivity(w, a) {
  switch (a.kind) {
    case "swimming":
      w.uint32(1, ActivityType.swimming);
      w.uint32Required(2, 1);
      w.uint32Required(3, SWIM_LOCATION_PROTO[a.swimmingLocation ?? "unknown"]);
      return;
    case "cycling":
      w.uint32(1, ActivityType.cycling);
      w.uint32Required(2, LOCATION_PROTO[a.location ?? "unknown"]);
      w.uint32Required(3, 0);
      return;
    case "running":
      w.uint32(1, ActivityType.running);
      w.uint32Required(2, LOCATION_PROTO[a.location ?? "unknown"]);
      w.uint32Required(3, 0);
      return;
  }
}
function writeSwimBikeRunWorkout(w, s) {
  for (const a of s.activities) {
    w.message(1, (sub) => writeSbrActivity(sub, a));
  }
  w.string(2, s.displayName);
}
function encodeWorkoutPlan(plan) {
  const present = [plan.custom, plan.goal, plan.pacer, plan.swimBikeRun].filter(
    (v) => v !== void 0
  ).length;
  if (present === 0) {
    throw new Error("WorkoutPlan must contain one of: custom | goal | pacer | swimBikeRun");
  }
  if (present > 1) {
    throw new Error("WorkoutPlan must contain exactly one of: custom | goal | pacer | swimBikeRun");
  }
  const w = new Writer();
  w.string(9, plan.referenceId);
  if (plan.custom) w.message(PLAN_FIELD.custom, (sub) => writeCustomWorkout(sub, plan.custom));
  if (plan.goal) w.message(PLAN_FIELD.goal, (sub) => writeSingleGoalWorkout(sub, plan.goal));
  if (plan.pacer) w.message(PLAN_FIELD.pacer, (sub) => writePacerWorkout(sub, plan.pacer));
  if (plan.swimBikeRun)
    w.message(PLAN_FIELD.swimBikeRun, (sub) => writeSwimBikeRunWorkout(sub, plan.swimBikeRun));
  w.uint32Required(1e3, 1);
  w.uint32Required(1002, 5);
  return w.finish();
}

// src/encode-api.ts
function toJson(plan) {
  const candidate = plan;
  return typeof candidate.toJSON === "function" ? candidate.toJSON() : plan;
}
function encode(plan) {
  return encodeWorkoutPlan(toJson(plan));
}
function toBlob(plan, type = "application/octet-stream") {
  return new Blob([encode(plan)], { type });
}
function toBase64(plan) {
  const bytes = encode(plan);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}


//# sourceMappingURL=encode.js.map
//# sourceMappingURL=encode.js.map
Object.assign(globalThis.VeyvoWorkoutKit ||= {}, { encode, toBase64, toBlob });
})();
