/* Editable owner-only offer and non-selection email drafts for the private hiring dashboard. */
(function () {
  'use strict';
  if (!location.pathname.startsWith('/hiring')) return;

  var style = document.createElement('style');
  style.textContent = [
    '.offer-launch{margin:12px 0;padding:14px;border-radius:10px;background:#f2f8f2;border:1px solid #cbded0;display:flex;gap:12px;align-items:center;flex-wrap:wrap}',
    '.offer-launch button,.offer-modal .offer-primary{background:#206b48;color:#fff;border:0;border-radius:7px;padding:10px 15px;font-weight:700;cursor:pointer}',
    '.offer-launch span{font-size:12px;color:#415a4a}',
    '.offer-shade{position:fixed;inset:0;z-index:100000;background:rgba(15,30,25,.73);overflow:auto;display:flex;justify-content:center;padding:20px}',
    '.offer-modal{background:#fff;color:#24362e;width:min(820px,100%);padding:24px;border-radius:15px;margin:auto 0;box-shadow:0 18px 60px #1115;font:14px/1.5 system-ui,sans-serif;box-sizing:border-box}',
    '.offer-modal *{box-sizing:border-box}.offer-modal h2{font-size:23px;margin:0}.offer-modal h3{font-size:16px;margin:18px 0 8px}',
    '.offer-modal .offer-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}',
    '.offer-modal label{display:block;margin:12px 0 5px;font-weight:650}',
    '.offer-modal input,.offer-modal textarea{display:block;width:100%;border:1px solid #c1cfc5;border-radius:7px;padding:10px;font:inherit;background:#fff;color:#222}',
    '.offer-modal textarea{min-height:225px;resize:vertical}',
    '.offer-modal .offer-preview{white-space:pre-wrap;background:#f7f9f7;border:1px solid #d9e3dc;border-radius:8px;padding:15px;max-height:245px;overflow:auto}',
    '.offer-modal .offer-hint{font-size:12px;color:#53665d;margin:9px 0}',
    '.offer-modal .offer-warning{border-left:3px solid #b48b39;background:#fff8e8;padding:11px;margin-top:12px;font-size:12px}',
    '.offer-modal .offer-buttons{display:flex;justify-content:flex-end;gap:10px;flex-wrap:wrap;margin-top:15px}',
    '.offer-modal .offer-neutral{background:#fff;border:1px solid #b8c9c0;border-radius:7px;padding:10px 14px;cursor:pointer}',
    '.offer-modal .offer-error{min-height:18px;color:#a32929;font-weight:600}',
    '@media(max-width:600px){.offer-modal{padding:15px}.offer-modal .offer-grid{grid-template-columns:1fr}}'
  ].join('');
  document.head.appendChild(style);

  function isOwner() {
    return Array.from(document.querySelectorAll('small')).some(function(e){
      return e.textContent.trim() === 'Recruitment owner';
    });
  }
  function callTitle() {
    var select = document.querySelector('select[aria-label="Select research call"]');
    return (select && select.selectedOptions[0]
      ? select.selectedOptions[0].textContent : 'Research opportunity').split(' · ')[0].trim();
  }
  function attach() {
    var profile = document.querySelector('.modal[aria-labelledby="profile-title"]');
    if (!profile || !isOwner()) return;
    var head = profile.querySelector('.profile-head');
    if (!head) return;
    var badge = head.querySelector('.badge');
    var status = badge ? badge.textContent.trim() : '';
    var offer = status === 'Offered';
    var notSelected = status === 'Shortlisted' || status === 'Not shortlisted';
    var oldOffer = profile.querySelector('[data-offer-launch]');
    var oldDecision = profile.querySelector('[data-decision-launch]');
    if (!offer && oldOffer) oldOffer.remove();
    if (!notSelected && oldDecision) oldDecision.remove();
    if ((!offer || oldOffer) && (!notSelected || oldDecision)) return;
    var nameNode = profile.querySelector('#profile-title');
    var link = head.querySelector('a[href^="mailto:"]');
    if (!nameNode || !link) return;
    var name = nameNode.textContent.trim();
    var email = link.getAttribute('href').slice(7).trim();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return;
    if (offer && !oldOffer) {
      var offerBox = document.createElement('div');
      offerBox.className = 'offer-launch';
      offerBox.setAttribute('data-offer-launch', '1');
      var offerButton = document.createElement('button');
      offerButton.type = 'button';
      offerButton.textContent = 'Prepare offer letter';
      offerButton.onclick = function(){ editOffer(name,email,callTitle()); };
      var offerHint = document.createElement('span');
      offerHint.textContent = 'Edit and preview before opening the message in Gmail.';
      offerBox.append(offerButton,offerHint);
      head.insertAdjacentElement('afterend',offerBox);
    }
    if (notSelected && !oldDecision) {
      var decisionBox = document.createElement('div');
      decisionBox.className = 'offer-launch';
      decisionBox.setAttribute('data-decision-launch', '1');
      var decisionButton = document.createElement('button');
      decisionButton.type = 'button';
      decisionButton.textContent = 'Prepare non-selection email';
      decisionButton.onclick = function(){ editNotSelected(name,email,callTitle(),status); };
      var decisionHint = document.createElement('span');
      decisionHint.textContent = status === 'Shortlisted'
        ? 'For candidates you have decided not to select; editing or sending does not change their status.'
        : 'Edit and preview a respectful decision message before sending.';
      decisionBox.append(decisionButton,decisionHint);
      head.insertAdjacentElement('afterend',decisionBox);
    }
  }

  function editNotSelected(name,email,role,status) {
    if (status !== 'Shortlisted' && status !== 'Not shortlisted') return;
    var old = document.querySelector('.offer-shade');
    if (old) old.remove();
    var shade = document.createElement('div');
    shade.className = 'offer-shade';
    shade.innerHTML =
      '<section class="offer-modal" role="dialog" aria-modal="true" aria-labelledby="decision-title">' +
      '<h2 id="decision-title">Prepare non-selection email</h2>' +
      '<p class="offer-hint" id="decision-to"></p>' +
      '<div class="offer-grid"><div><label for="decision-role">Opportunity</label><input id="decision-role"></div>' +
      '<div><label for="decision-subject">Subject</label><input id="decision-subject"></div></div>' +
      '<label for="decision-body">Message — edit freely</label><textarea id="decision-body"></textarea>' +
      '<p class="offer-hint">Use {{NAME}} and {{ROLE}}. The message does not disclose scores, reviewer comments, or another applicant’s details.</p>' +
      '<h3>Live preview</h3><div class="offer-preview" id="decision-preview"></div>' +
      '<div class="offer-warning" id="decision-warning"></div>' +
      '<p class="offer-error" role="alert" id="decision-error"></p>' +
      '<div class="offer-buttons"><button type="button" class="offer-neutral" id="decision-close">Cancel</button>' +
      '<button type="button" class="offer-neutral" id="decision-copy">Copy message</button>' +
      '<button type="button" class="offer-primary" id="decision-gmail">Open in Gmail to send ↗</button></div>' +
      '</section>';
    document.body.appendChild(shade);
    var el = function(id){ return shade.querySelector('#'+id); };
    el('decision-to').textContent = 'Applicant: '+name+' — '+email+' · Current status: '+status;
    el('decision-role').value = role;
    el('decision-subject').value = 'Update on your research application — {{ROLE}}';
    el('decision-body').value = [
      'Dear {{NAME}},','',
      'Thank you for your interest in joining our research team at New Uzbekistan University and for the time you invested in the selection process for {{ROLE}}.','',
      'After careful consideration, we regret to inform you that we will not be moving forward with your application for this opportunity. This was a competitive process, and we appreciate the effort you put into your application and discussions with our team.','',
      'Thank you again for your interest. We wish you every success in your studies and future research.','',
      'Best regards,','Mohammad Sabokrou','Associate Professor, School of Computing','New Uzbekistan University'
    ].join('\n');
    el('decision-warning').textContent =
      (status === 'Shortlisted'
      ? 'This applicant is still marked Shortlisted. Confirm that the decision is final before sending. '
      : '') +
      'Gmail opens an editable draft; you must click Send there. Neither opening the draft nor sending it through Gmail automatically updates applicant status or records delivery in this dashboard.';
    function render() {
      var vals = {NAME:name, ROLE:el('decision-role').value};
      var replace = function(s) {return s.replace(/\{\{(NAME|ROLE)\}\}/g,function(_,k){return vals[k];});};
      var subject = replace(el('decision-subject').value);
      var body = replace(el('decision-body').value);
      el('decision-preview').textContent = 'To: '+email+'\nSubject: '+subject+'\n\n'+body;
      return {subject:subject,body:body};
    }
    function valid() {
      el('decision-error').textContent = '';
      if (!el('decision-role').value.trim() || !el('decision-subject').value.trim() || !el('decision-body').value.trim()) {
        el('decision-error').textContent = 'Complete the opportunity, subject and message before sending.';
        return false;
      }
      return true;
    }
    function close(){ document.removeEventListener('keydown',onKeydown);shade.remove(); }
    function onKeydown(e){ if(e.key === 'Escape') close(); }
    document.addEventListener('keydown',onKeydown);
    shade.addEventListener('click',function(e){if(e.target===shade)close();});
    el('decision-close').onclick=close;
    ['decision-role','decision-subject','decision-body'].forEach(function(id){el(id).addEventListener('input',render);});
    el('decision-copy').onclick=async function(){
      if(!valid())return;
      var draft=render();
      try{
        await navigator.clipboard.writeText('To: '+email+'\nSubject: '+draft.subject+'\n\n'+draft.body);
        el('decision-copy').textContent='Copied';
      }catch(_) {el('decision-error').textContent='Unable to copy. Select the preview text instead.';}
    };
    el('decision-gmail').onclick=function(){
      if(!valid())return;
      if(!confirm('Confirm that '+name+' has not been selected for this opportunity. Open the message in Gmail for final review and sending?'))return;
      var draft=render();
      var url='https://mail.google.com/mail/?view=cm&fs=1&to='+encodeURIComponent(email)+
        '&su='+encodeURIComponent(draft.subject)+'&body='+encodeURIComponent(draft.body);
      window.open(url,'_blank','noopener,noreferrer');
    };
    render();
    el('decision-subject').focus();
  }

  function editOffer(name,email,role) {
    var old = document.querySelector('.offer-shade');
    if(old) old.remove();
    var shade = document.createElement('div');
    shade.className = 'offer-shade';
    shade.innerHTML =
      '<section class="offer-modal" role="dialog" aria-modal="true" aria-labelledby="offer-title">' +
      '<h2 id="offer-title">Prepare offer letter</h2><p class="offer-hint" id="offer-to"></p>' +
      '<div class="offer-grid"><div><label for="offer-role">Opportunity</label><input id="offer-role"></div>' +
      '<div><label for="offer-deadline">Response deadline (Tashkent, UTC+5)</label><input type="datetime-local" id="offer-deadline"></div></div>' +
      '<label for="offer-subject">Email subject</label><input id="offer-subject">' +
      '<label for="offer-body">Letter — edit freely</label><textarea id="offer-body"></textarea>' +
      '<p class="offer-hint">Use {{NAME}}, {{ROLE}}, and {{DEADLINE}} as editable placeholders.</p>' +
      '<h3>Live preview</h3><div class="offer-preview" id="offer-preview"></div>' +
      '<div class="offer-warning">Gmail will open with your reviewed draft. You must click Send in Gmail. This does not automatically record delivery or acceptance in the hiring dashboard.</div>' +
      '<p class="offer-error" role="alert" id="offer-error"></p>' +
      '<div class="offer-buttons"><button type="button" class="offer-neutral" id="offer-close">Cancel</button>' +
      '<button type="button" class="offer-neutral" id="offer-copy">Copy letter</button>' +
      '<button type="button" class="offer-primary" id="offer-gmail">Open in Gmail to send ↗</button></div></section>';
    document.body.appendChild(shade);
    var el = function(id){return shade.querySelector('#'+id);};
    el('offer-to').textContent = 'Applicant: '+name+' — '+email;
    el('offer-role').value = role;
    el('offer-subject').value = 'Research team offer — '+role;
    el('offer-body').value = [
      'Dear {{NAME}},','',
      'We are pleased to offer you an opportunity to join our research team at New Uzbekistan University as part of {{ROLE}}.','',
      'We would be happy to work with you on research activities and discuss the next steps once you confirm your interest.','',
      'Please reply to this email by {{DEADLINE}} to accept or decline this invitation.','',
      'Any stipend, funding, or formal appointment is subject to separate written confirmation and applicable university approval.','',
      'Best regards,','Mohammad Sabokrou','Associate Professor, School of Computing','New Uzbekistan University'
    ].join('\n');
    function deadline() {
      var val=el('offer-deadline').value;
      if(!val) return '[SET RESPONSE DEADLINE]';
      var parts=val.split('T'), d=parts[0].split('-');
      return d[2]+'/'+d[1]+'/'+d[0]+' at '+parts[1]+' (Tashkent, UTC+5)';
    }
    function render(){
      var vals={NAME:name,ROLE:el('offer-role').value,DEADLINE:deadline()};
      var replace = function(str){return str.replace(/\{\{(NAME|ROLE|DEADLINE)\}\}/g,function(_,k){return vals[k];});};
      var subject=replace(el('offer-subject').value);
      var body=replace(el('offer-body').value);
      el('offer-preview').textContent='To: '+email+'\nSubject: '+subject+'\n\n'+body;
      return {subject:subject,body:body};
    }
    function valid(){
      el('offer-error').textContent='';
      var date=el('offer-deadline').value;
      if(!date || !Number.isFinite(Date.parse(date+'+05:00')) || Date.parse(date+'+05:00')<=Date.now()){
        el('offer-error').textContent='Select a future deadline in Tashkent time.';return false;
      }
      if(!el('offer-role').value.trim() || !el('offer-subject').value.trim() || !el('offer-body').value.trim()){
        el('offer-error').textContent='Opportunity, subject, and letter are required.';return false;
      }
      return true;
    }
    var keyHandler = function(e){ if(e.key==='Escape') close(); };
    function close(){document.removeEventListener('keydown',keyHandler);shade.remove();}
    document.addEventListener('keydown',keyHandler);
    shade.addEventListener('click',function(e){if(e.target===shade) close();});
    el('offer-close').onclick=close;
    ['offer-role','offer-deadline','offer-subject','offer-body'].forEach(function(id){el(id).addEventListener('input',render);});
    el('offer-copy').onclick=async function(){
      if(!valid())return;
      var draft=render();
      try{await navigator.clipboard.writeText('To: '+email+'\nSubject: '+draft.subject+'\n\n'+draft.body);
        el('offer-copy').textContent='Copied';
      }catch(_){el('offer-error').textContent='Unable to copy. Use the preview text.';}
    };
    el('offer-gmail').onclick=function(){
      if(!valid())return;
      var draft=render();
      if(!confirm('Open the reviewed letter to '+email+' in Gmail? You must click Send in Gmail.'))return;
      var url='https://mail.google.com/mail/?view=cm&fs=1&to='+encodeURIComponent(email)+
        '&su='+encodeURIComponent(draft.subject)+'&body='+encodeURIComponent(draft.body);
      window.open(url,'_blank','noopener,noreferrer');
    };
    render();
    el('offer-deadline').focus();
  }

  var root=document.getElementById('root');
  if(!root)return;
  var pending=false;
  var observer=new MutationObserver(function(){
    if(pending)return;
    pending=true;
    requestAnimationFrame(function(){pending=false;attach();});
  });
  observer.observe(root,{subtree:true,childList:true});
  attach();
})();