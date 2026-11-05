/* Shared pure scheduling logic. All date calculations use calendar days, independent of browser timezone. */
(function(root){
'use strict';
const dayNames=['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'];
const clock=n=>String(Math.floor(n/60)).padStart(2,'0')+':'+String(n%60).padStart(2,'0');
const dateValue=s=>{if(!/^\d{4}-\d{2}-\d{2}$/.test(s))throw Error('Enter valid dates.');const d=new Date(s+'T00:00:00Z');if(!Number.isFinite(+d)||d.toISOString().slice(0,10)!==s)throw Error('Enter valid dates.');return d;};
const dates=(a,b)=>{const start=dateValue(a),end=dateValue(b);if(end<start)throw Error('End date must follow start date.');if((end-start)/86400000>120)throw Error('Choose a range of at most 120 days.');let out=[];for(let d=start;d<=end;d=new Date(+d+86400000))out.push(d.toISOString().slice(0,10));return out;};
const day=s=>(dateValue(s).getUTCDay()+6)%7;
const overlap=(a,b)=>a.start<b.end&&b.start<a.end;
const norm=s=>s.trim().replace(/\s+/g,'').toUpperCase();
function normalize(data){
 if(!Array.isArray(data.faculty)||!data.source?.retrievedAt)throw Error('Timetable must contain faculty and source.retrievedAt.');
 const rooms=new Set();for(const p of data.faculty)for(const c of p.classes||[]){const parts=(c.label||'').split(' · ');if(parts.length>=3)parts[2].split('/').forEach(x=>rooms.add(x.trim()));}
 const blocks=[];for(const p of data.faculty)for(const c of p.classes||[]){
 if(!Number.isInteger(c.day)||c.day<0||c.day>6||!Number.isFinite(c.start)||!Number.isFinite(c.end)||c.start<0||c.end>1440||c.start>=c.end)throw Error('Invalid timetable interval.');
 const parts=(c.label||'').split(' · '),second=parts[1]||'';
 const room=parts.length>=3?parts[2]:rooms.has(second)?second:'';
 const groups=parts.length>=3||!room?second.split('/').map(x=>x.trim()).filter(Boolean):[];
 blocks.push({...c,teacher:p.id,teacherName:p.name,code:parts[0],groups,rooms:room.split('/').filter(Boolean)});
 }
 return {faculty:data.faculty,source:data.source,blocks,rooms:[...rooms].sort(),groups:[...new Set(blocks.flatMap(b=>b.groups))].sort()};
}
function infer(block,model,curricula){
 const related=model.blocks.filter(b=>b.code===block.code);
 const inferredGroups=[...new Set(related.flatMap(b=>b.groups))];
 const programs=[];for(const p of curricula.programs||[]){const matches=p.courses.filter(c=>c.code===block.code);for(const semester of [...new Set(matches.map(c=>c.semester))])programs.push({name:p.name,semester,url:p.url,basis:'Course-code curriculum match',courses:p.courses.filter(c=>c.semester===semester).map(c=>c.code)});}
 // Fall-cohort prefixes are an explicit, reviewable heuristic, never enrolment evidence.
 const aliases={AR:'AI & Robotics',CS:'Cyber Security',SE:'Software Engineering',AM:'Applied Mathematics',EDS:'Economics & Data Science',IM:'Industrial Management',ME:'Mechanical Engineering',CHE:'Chemical & Materials Engineering',P:'STEM Education',AE:'Aerospace Engineering'};
 for(const group of (block.groups.length?block.groups:inferredGroups)){const match=norm(group).match(/^(SE|F|S|J)([A-Z]+)\d*$/);if(!match)continue;const semester={F:1,S:3,J:5,SE:7}[match[1]],fragment=aliases[match[2]];if(!fragment)continue;const p=(curricula.programs||[]).find(p=>p.name.includes(fragment)&&p.name.startsWith('B.Sc.'));if(!p)continue;let existing=programs.find(x=>x.name===p.name&&x.semester===semester);if(existing){existing.basis='Course code and cohort-code estimate';continue;}programs.push({name:p.name,semester,url:p.url,basis:'Estimated from '+group+' cohort code (Fall)',courses:p.courses.filter(c=>c.semester===semester).map(c=>c.code)});}
 return {groups:block.groups.length?block.groups:inferredGroups,basis:block.groups.length?'Published class groups':inferredGroups.length?'Inferred from other sections of this course':'Unknown — select student groups',programs};
}
function affected(model,teacher,from,to){return dates(from,to).flatMap(date=>model.blocks.filter(b=>b.teacher===teacher&&b.day===day(date)).map((b,i)=>({...b,date,id:date+'_'+i})));}
function candidates(model,target,settings,reservations=[]){
 const days=dates(settings.from,settings.to),duration=target.end-target.start;
 if(!target.groups.length)throw Error('Select at least one student group before calculating.');
 if(!Number.isFinite(settings.start)||!Number.isFinite(settings.end)||settings.start>=settings.end||duration>settings.end-settings.start)throw Error('Working hours must fit the original class duration.');
 const excluded=new Set(settings.excluded||[]),potential=new Set(settings.potentialCodes||[]),wanted=new Set(target.groups.map(norm));
 const all=[];
 for(const date of days){if(date<settings.today||date>=settings.travelFrom&&date<=settings.travelTo||excluded.has(date))continue;
 const d=day(date);if(d>=5&&!settings.weekends)continue;
 for(let start=settings.start;start+duration<=settings.end;start+=30){
 const slot={date,day:d,start,end:start+duration,weekend:d>=5};
 const nearby=model.blocks.filter(b=>b.day===d&&overlap(slot,b));
 const teacher=nearby.filter(b=>b.teacher===target.teacher);
 const student=nearby.filter(b=>b.groups.some(g=>wanted.has(norm(g))));
 const possible=nearby.filter(b=>potential.has(b.code)&&!student.includes(b));
 const planned=reservations.filter(r=>r.date===date&&overlap(r,slot));
 const reservedConflict=planned.some(r=>r.teacher===target.teacher||r.groups.some(g=>wanted.has(norm(g))));
 const freeRooms=model.rooms.filter(room=>(!settings.room||room===settings.room)&&!nearby.some(b=>b.rooms.includes(room))&&!planned.some(r=>r.room===room)).sort((a,b)=>Number((target.rooms||[]).includes(b))-Number((target.rooms||[]).includes(a))||Number(/Lab|3D/i.test(a))-Number(/Lab|3D/i.test(b))||a.localeCompare(b));
 const blockers=[...(teacher.length?['Lecturer teaching']:[]),...(student.length?['Student-group class']:[]),...(reservedConflict?['Another selected make-up class']:[]),...(!freeRooms.length?['No room without a listed booking']:[])];
 const lunch=start<810&&slot.end>750;
 const score=Math.max(1,100-(possible.length?30:0)-(lunch?8:0)-(start<540||slot.end>1050?5:0));
 all.push({...slot,freeRooms,teacher,student,possible,blockers,score,selectable:!blockers.length});
 }
 }
 return all.sort((a,b)=>Number(a.weekend)-Number(b.weekend)||Number(b.selectable)-Number(a.selectable)||Number(a.possible.length>0)-Number(b.possible.length>0)||a.possible.length-b.possible.length||b.score-a.score||a.date.localeCompare(b.date)||a.start-b.start);
}
const api={normalizeGroup:norm,dayNames,clock,dates,day,overlap,normalize,infer,affected,candidates};if(typeof module!=='undefined')module.exports=api;else root.MakeupEngine=api;
})(typeof window!=='undefined'?window:globalThis);
