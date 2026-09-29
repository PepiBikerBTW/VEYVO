const test=require('node:test');
const assert=require('node:assert/strict');
const calendar=require('../src/calendar-context.js');

test('calendar shows a Monday-to-Sunday week across month boundaries',()=>{
 assert.deepEqual(calendar.weekDays(new Date(2026,8,28)),['2026-09-28','2026-09-29','2026-09-30','2026-10-01','2026-10-02','2026-10-03','2026-10-04']);
 assert.equal(calendar.weekDays(new Date(2026,8,28),-2)[0],'2026-09-14');
});

test('calendar distinguishes recorded sessions, next run, rest, and unknown days',()=>{
 const context={runs:[{date:'2026-09-13T12:00:00',distance:3.31,time:'25:37',type:'Běh'}],milestones:[{date:'2026-09-15',label:'5×400 m intervaly'}],availableDays:[0,1,3,5,6],nextRun:{kind:'easy',date:'2026-09-29'},today:'2026-09-28'};
 assert.equal(calendar.entriesForDay('2026-09-13',context)[0].kind,'run');
 assert.equal(calendar.entriesForDay('2026-09-15',context)[0].kind,'milestone');
 assert.equal(calendar.entriesForDay('2026-09-29',context)[0].kind,'planned');
 assert.equal(calendar.entriesForDay('2026-09-30',context)[0].kind,'rest');
 assert.equal(calendar.entriesForDay('2026-10-01',context)[0].kind,'pending');
 assert.equal(calendar.entriesForDay('2026-09-30',{...context,availableDays:[1,6],today:'2026-09-29'})[0].kind,'rest');
 assert.equal(calendar.entriesForDay('2026-10-02',{...context,availableDays:[1,6],today:'2026-09-29'})[0].kind,'rest');
 assert.equal(calendar.entriesForDay('2026-09-14',context)[0].kind,'unlogged');
});
