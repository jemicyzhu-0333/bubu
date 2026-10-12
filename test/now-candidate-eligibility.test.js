const test=require('node:test'); const assert=require('node:assert/strict');
const {projectRecommendations}=require('../src/capabilities/guidance/domain/recommendations');
const {taskStartBlockReason}=require('../src/capabilities/work/domain/task-availability');
const now=Date.parse('2026-10-12T12:00:00Z');
for(const extra of [{},{seriesId:'daily-series',occurrenceDate:'2026-10-12'},{seriesId:'daily-series',plannedFor:'2026-10-13',occurrenceDate:'2026-10-13'}]) {
test('title-only candidate remains eligible '+JSON.stringify(extra),()=>{
 const task={id:'occurrence-unique',title:'Only title',done:false,steps:[],nextAction:null,createdAt:now,...extra};
 const result=projectRecommendations({state:{tasks:[task],stats:{},nowTaskId:task.id},settings:{},pomodoro:{},now,curveLevel:50},taskStartBlockReason,()=>now);
 assert.equal(result.candidates[0].id,task.id);
 assert.equal(result.nowCandidate.id,task.id);
});}
test('actual temporal and terminal exclusion matrix',()=>{
 for(const [patch,expected] of [[{done:true},'task-completed'],[{skippedAt:now},'occurrence-skipped'],[{expiresAt:new Date(now-1).toISOString()},'task-expired'],[{scheduledFor:new Date(now+1).toISOString()},'task-scheduled']])
 assert.equal(taskStartBlockReason({id:'a',steps:[],...patch},now),expected);
});

