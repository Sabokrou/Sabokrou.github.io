import { SUPABASE_URL, SUPABASE_ANON_KEY } from '../../data-science-fundamentals/grade-tracker/official-config.mjs';

const $ = id => document.getElementById(id);
let db, roster = [], definitions = [], grades = [], me = null, role = null;
const edits = new Map();
const visible = id => { for (const name of ['auth','claim','student','staff']) $(name).hidden = name !== id; $('signout').hidden = id === 'auth'; };
const alert = (value, error=false) => { $('message').textContent=value; $('message').className=`panel notice ${error?'error':'success'}`; $('message').hidden=!value; };
const result = ({data,error}) => { if(error) throw error; return data; };
const money = n => Number(n).toFixed(2).replace(/\.00$/,'');
function cell(row,value,tag='td') { const e=document.createElement(tag);e.textContent=value;row.append(e);return e; }
async function run(button,action) { button.disabled=true;try{await action();}catch(e){console.error(e);alert(e.message||'Could not complete the request.',true);}finally{button.disabled=false;} }

async function enter() {
  alert('');
  const {data:{session},error}=await db.auth.getSession();if(error)throw error;
  if(!session){$('account').textContent='';visible('auth');return;}
  $('account').textContent=session.user.email||'';
  role=result(await db.rpc('my_grade_role'));
  if(role==='instructor'||role==='ta'){await loadStaff();visible('staff');return;}
  const rows=result(await db.from('cv_students').select('id,learner_id,university_id,full_name,cohort').eq('auth_user_id',session.user.id));
  me=rows[0];if(me){await loadStudent();visible('student');return;}
  const request=result(await db.rpc('cv_my_connection'));
  $('claim-form').hidden=request?.status==='pending';
  $('claim-status').textContent=request?.status==='pending'
    ? `Waiting for staff approval of ID ${request.university_id}. Check again after the teaching team verifies your identity.`
    : request?.status==='rejected' ? `The request for ID ${request.university_id} was rejected. Check the ID or speak to the teaching team before requesting again.`
    : 'Enter your university ID to request access to your Computer Vision record.';
  visible('claim');
}

async function loadStudent() {
  definitions=result(await db.from('cv_assessments').select('*').order('sort_order'));
  grades=result(await db.from('cv_grades').select('assessment_key,score,note,published').eq('student_id',me.id).eq('published',true));
  const byKey=new Map(grades.map(g=>[g.assessment_key,g]));
  $('student-name').textContent=me.full_name;
  $('student-meta').textContent=`${me.cohort} · University ID ${me.university_id}`;
  const labs=definitions.filter(d=>d.category==='lab');
  const scored=labs.filter(d=>byKey.has(d.key));
  const labPoints=scored.reduce((sum,d)=>sum+Number(byKey.get(d.key).score)/Number(d.max_score),0)*10/labs.length;
  const project=definitions.find(d=>d.category==='project');
  const projectGrade=project&&byKey.get(project.key);
  const projectPoints=projectGrade?Number(projectGrade.score)/Number(project.max_score)*Number(project.weight):0;
  $('lab-total').textContent=`${money(labPoints)} / 10`;
  $('lab-count').textContent=`${scored.length} of ${labs.length} labs released`;
  $('project-total').textContent=`${money(projectPoints)} / 15`;
  $('project-count').textContent=projectGrade?'Project released':'Project pending';
  $('known-total').textContent=`${money(labPoints+projectPoints)} / 25`;
  $('student-labs').replaceChildren();$('student-project').replaceChildren();$('student-exams').replaceChildren();
  for(const d of definitions){const row=document.createElement('tr'),g=byKey.get(d.key);
    cell(row,d.label);cell(row,g?`${money(g.score)} / ${money(d.max_score)}`:'Not released');cell(row,g?.note||'—');
    (d.category==='lab'?$('student-labs'):d.category==='project'?$('student-project'):$('student-exams')).append(row);
  }
}

async function loadStaff() {
  [definitions,roster,grades]=await Promise.all([
    db.from('cv_assessments').select('*').order('sort_order').then(result),
    db.from('cv_students').select('id,learner_id,university_id,full_name,cohort').order('full_name').then(result),
    db.from('cv_grades').select('student_id,assessment_key,score,published,note').then(result)
  ]);
  edits.clear();
  $('assessment').replaceChildren();for(const d of definitions){const o=new Option(`${d.label} · ${money(d.max_score)} marks`,d.key);$('assessment').append(o);}
  $('group').replaceChildren(new Option('All groups',''));
  for(const group of [...new Set(roster.map(s=>s.cohort))].sort())$('group').append(new Option(group,group));
  renderStaff();await loadRequests();
}

function renderStaff() {
  const key=$('assessment').value,assessment=definitions.find(d=>d.key===key);
  if(!assessment)return;
  const search=$('search').value.trim().toLowerCase(),group=$('group').value;
  const list=roster.filter(s=>(!group||s.cohort===group)&&`${s.full_name} ${s.university_id} ${s.learner_id}`.toLowerCase().includes(search));
  $('staff-count').textContent=`${list.length} students shown · ${edits.size} unsaved edits`;
  $('staff-rows').replaceChildren();
  for(const s of list){
    const old=grades.find(g=>g.student_id===s.id&&g.assessment_key===key);
    const edit=edits.get(`${s.id}:${key}`),v=edit||old||{};
    const row=document.createElement('tr');
    const who=cell(row,s.full_name);cell(who,`${s.university_id} · ${s.cohort}`,'small');
    const scoreCell=cell(row,'');const score=document.createElement('input');score.type='number';score.min='0';score.max=String(assessment.max_score);score.step='0.01';score.value=v.score??'';score.setAttribute('aria-label',`${s.full_name} score out of ${assessment.max_score}`);scoreCell.append(score);
    const publishCell=cell(row,'');const publish=document.createElement('input');publish.type='checkbox';publish.checked=Boolean(v.published);publish.setAttribute('aria-label',`Publish ${s.full_name} result`);publishCell.append(publish);
    const noteCell=cell(row,'');const note=document.createElement('input');note.type='text';note.maxLength=1000;note.value=v.note??'';note.setAttribute('aria-label',`${s.full_name} feedback`);noteCell.append(note);
    const changed=()=>{edits.set(`${s.id}:${key}`,{student_id:s.id,assessment_key:key,score:score.value===''?null:Number(score.value),published:publish.checked,note:note.value.trim()||null});$('staff-count').textContent=`${list.length} students shown · ${edits.size} unsaved edits`;};
    for(const input of [score,publish,note])input.addEventListener('input',changed);
    $('staff-rows').append(row);
  }
}

async function loadRequests() {
  const requests=result(await db.rpc('cv_list_connections'))||[];$('requests').replaceChildren();
  for(const request of requests){const row=document.createElement('tr');cell(row,request.email);cell(row,`${request.full_name||'ID not in roster'} · ${request.university_id} · ${request.cohort||'—'}`);
    const actions=cell(row,'');for(const [label,approve] of [['Approve',true],['Reject',false]]){
      const button=document.createElement('button');button.textContent=label;button.type='button';if(!approve)button.className='alt';button.disabled=approve&&!request.available;
      button.onclick=()=>run(button,async()=>{if(!confirm(approve?`Have you verified that ${request.email} belongs to ${request.full_name} (${request.university_id})?`:`Reject the request for ${request.university_id}?`))return;result(await db.rpc('cv_review_connection',{request_id:request.id,approve}));await loadRequests();alert(approve?'Connection approved.':'Request rejected.');});actions.append(button);
    }$('requests').append(row);
  }
  if(!requests.length){const row=document.createElement('tr');cell(row,'No pending requests.').colSpan=3;$('requests').append(row);}
}

$('email-form').onsubmit=e=>{e.preventDefault();run(e.submitter,async()=>{const email=$('email').value.trim();result(await db.auth.signInWithOtp({email,options:{shouldCreateUser:true}}));$('otp-form').hidden=false;alert('Check your inbox for a one-time code.');});};
$('otp-form').onsubmit=e=>{e.preventDefault();run(e.submitter,async()=>{result(await db.auth.verifyOtp({email:$('email').value.trim(),token:$('otp').value.trim(),type:'email'}));await enter();});};
$('claim-form').onsubmit=e=>{e.preventDefault();run(e.submitter,async()=>{result(await db.rpc('cv_request_connection',{student_id:$('student-id').value.trim()}));await enter();alert('Request sent. The teaching team will verify your identity.');});};
$('check-approval').onclick=e=>run(e.currentTarget,enter);
$('refresh-student').onclick=e=>run(e.currentTarget,loadStudent);
$('refresh-requests').onclick=e=>run(e.currentTarget,loadRequests);
$('signout').onclick=e=>run(e.currentTarget,async()=>{result(await db.auth.signOut());me=null;role=null;await enter();});
$('assessment').onchange=renderStaff;$('group').onchange=renderStaff;$('search').oninput=renderStaff;
$('save').onclick=e=>run(e.currentTarget,async()=>{
  const updates=[...edits.values()],byKey=new Map(definitions.map(d=>[d.key,d]));
  for(const v of updates){const d=byKey.get(v.assessment_key);if(v.score!==null&&(!Number.isFinite(v.score)||v.score<0||v.score>Number(d.max_score)))throw Error(`Scores must be between 0 and ${d.max_score}.`);if(v.published&&v.score===null)throw Error('Enter a score before publishing.');}
  if(!updates.length){alert('No edits to save.');return;}
  const filled=updates.filter(v=>v.score!==null||v.note||v.published);
  const blank=updates.filter(v=>!filled.includes(v));
  if(filled.length)result(await db.from('cv_grades').upsert(filled,{onConflict:'student_id,assessment_key'}));
  for(const v of blank)result(await db.from('cv_grades').delete().eq('student_id',v.student_id).eq('assessment_key',v.assessment_key));
  grades=grades.filter(g=>!edits.has(`${g.student_id}:${g.assessment_key}`)).concat(filled);edits.clear();renderStaff();alert(`${updates.length} result${updates.length===1?'':'s'} saved. Published results are visible to the corresponding student.`);
});

try{const {createClient}=await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.57.4/+esm');db=createClient(SUPABASE_URL,SUPABASE_ANON_KEY,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}});await enter();}
catch(e){console.error(e);alert(e.message||'The grade portal is temporarily unavailable.',true);visible('auth');}
