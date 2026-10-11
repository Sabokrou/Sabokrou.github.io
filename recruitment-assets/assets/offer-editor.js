/* Editable offer-letter frontend for status=Offered. The owner sends from Gmail. */
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
    var offered = Array.from(head.querySelectorAll('.badge')).some(function(e){
      return e.textContent.trim() === 'Offered';
    });
    var old = profile.querySelector('[data-offer-launch]');
    if (!offered) { if (old) old.remove(); return; }
    if (old) return;
    var name = profile.querySelector('#profile-title');
    var link = head.querySelector('a[href^="mailto:"]');
    if (!name || !link) return;
    var email = link.getAttribute('href').slice(7).trim();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return;
    var box = document.createElement('div');
    box.className = 'offer-launch';
    box.setAttribute('data-offer-launch', '1');
    var button = document.createElement('button');
    button.type = 'button';
    button.textContent = 'Prepare offer letter';
    button.onclick = function(){ editOffer(name.textContent.trim(),email,callTitle()); };
    var hint = document.createElement('span');
    hint.textContent = 'Edit and preview before opening the message in Gmail.';
    box.append(button,hint);
    head.insertAdjacentElement('afterend',box);
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