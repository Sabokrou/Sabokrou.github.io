import {SERVICE,CATEGORIES,cleanBrief,decodeReturn,selectItems} from "./core.mjs";
const $=s=>document.querySelector(s),$$=s=>[...document.querySelectorAll(s)],CACHE="rs.web.brief.v1",SAVED="rs.web.saved.v1",PENDING="rs.web.pending.v1";
let brief=null,saved=[],view="brief",category="all",query="";
function note(text){$("#notice").textContent=text;$("#notice").hidden=!text;}
function read(key,fallback){try{return JSON.parse(localStorage.getItem(key))??fallback}catch{return fallback}}
function persist(){try{if(brief)localStorage.setItem(CACHE,JSON.stringify(brief));localStorage.setItem(SAVED,JSON.stringify(saved));}catch{note("Your browser could not save the cache. You can still read this briefing while the app stays open.");}}
function element(tag,cls,text){const e=document.createElement(tag);if(cls)e.className=cls;if(text!==undefined)e.textContent=text;return e;}
function icon(name){const s=document.createElementNS("http://www.w3.org/2000/svg","svg"),u=document.createElementNS(s.namespaceURI,"use");s.setAttribute("aria-hidden","true");u.setAttribute("href","#i-"+name);s.append(u);return s;}
function shortDate(date){try{return new Intl.DateTimeFormat("en-GB",{month:"short",day:"numeric",timeZone:"Asia/Tashkent"}).format(new Date(date.length===10?date+"T12:00:00Z":date));}catch{return "";}}
function card(item){
 const c=element("article","signal-card"),top=element("div","card-top"),tag=element("span","category-tag category-"+item.category,CATEGORIES[item.category]),save=element("button","save-button");
 const isSaved=saved.some(x=>x.url===item.url);save.setAttribute("aria-label",`${isSaved?"Unsave":"Save"} ${item.title}`);save.setAttribute("aria-pressed",String(isSaved));save.append(icon("bookmark"));save.addEventListener("click",()=>{saved=isSaved?saved.filter(x=>x.url!==item.url):[item,...saved].slice(0,200);persist();render();});top.append(tag,save);c.append(top,element("h2",null,item.title),element("p","summary",item.summary));
 if(item.why){const why=element("div","why-block");why.append(element("span","why-label","Why it matters"),element("p",null,item.why));c.append(why);}
 if(item.deadline)c.append(element("p","deadline","Deadline reported: "+shortDate(item.deadline)+" · verify in the original call"));
 if(item.eligibility)c.append(element("p","card-meta",item.eligibility));
 if(item.action)c.append(element("p","card-action",item.action));
 const bottom=element("div","card-bottom"),link=element("a","source-link","Read source");link.href=item.url;link.target="_blank";link.rel="noopener noreferrer";link.append(icon("link"));bottom.append(element("span","card-meta",item.source+(item.published?" · "+shortDate(item.published):"")),link);c.append(bottom);return c;
}
function empty(title,copy){const d=element("div","empty-filter");d.append(element("h2",null,title),element("p",null,copy));return d;}
function render(){
 $$("[data-view]").forEach(b=>{b.classList.toggle("active",b.dataset.view===view);b.setAttribute("aria-current",b.dataset.view===view?"page":"false")});["brief","saved","settings"].forEach(v=>$("#"+v+"-view").hidden=v!==view);$("#breadcrumb").textContent={brief:"My briefing",saved:"Saved",settings:"Preferences"}[view];$("#saved-count").textContent=String(saved.length);
 $("#updated-label").textContent=brief?"Last refreshed "+new Intl.DateTimeFormat("en-GB",{month:"short",day:"numeric",hour:"2-digit",minute:"2-digit",timeZone:"Asia/Tashkent"}).format(new Date(brief.updated))+" · Tashkent":"Your first briefing is waiting to be made.";$("#cache-status").textContent=brief?"Briefing cached · available offline":"No briefing cached";
 const items=selectItems(brief,saved,{category,query}),target=$("#brief-items");target.replaceChildren(...items.map(card));$("#first-brief").hidden=!!brief;$("#result-count").textContent=brief?items.length+" SIGNAL"+(items.length===1?"":"S"):"";$("#section-label").textContent=brief?"SELECTED FOR RELEVANCE, NOT POPULARITY":"A BRIEFING BUILT AROUND YOUR WORK";
 if(brief&&!items.length)target.append(empty(brief.items.length?"Nothing in this view.":"A quieter day.",brief.items.length?"Try another category or search term.":"No useful items were returned in your last refresh. Your saved items are still here."));
 $("#saved-items").replaceChildren(...saved.map(card));if(!saved.length)$("#saved-items").append(empty("Keep something good.","Tap the bookmark on a useful item to save it for later."));
}
function refresh(){
 if(!navigator.onLine){note("You’re offline. Your downloaded briefing and saved items are available; refresh when you reconnect.");return;}
 try{const pending={id:crypto.randomUUID(),created:Date.now()};localStorage.setItem(PENDING,JSON.stringify(pending));const u=new URL(SERVICE);u.searchParams.set("state",pending.id);location.assign(u.href);}catch{note("Your browser needs local storage to return a briefing safely. Enable storage for this app and try again.");}
}
try{const cached=read(CACHE,null);if(cached)brief=cleanBrief(cached);saved=(read(SAVED,[])||[]).slice(0,200).flatMap(x=>{try{return cleanBrief({version:1,updated:new Date().toISOString(),items:[x]}).items}catch{return []}});}catch{note("An older cache could not be read. Create a new briefing to replace it.");}
if(location.hash.includes("brief=")){
 try{const result=decodeReturn(location.hash,read(PENDING,null));if(result){brief=result;persist();localStorage.removeItem(PENDING);note("Your briefing is refreshed. Every item links to the original source; check grant eligibility and deadlines there.");}}
 catch(e){note(e.message);}finally{history.replaceState(null,"",location.pathname+location.search);}
}
$("#date-label").textContent=new Intl.DateTimeFormat("en-GB",{weekday:"long",day:"numeric",month:"long",timeZone:"Asia/Tashkent"}).format(new Date()).toUpperCase();
$$("[data-view]").forEach(b=>b.addEventListener("click",()=>{view=b.dataset.view;render();window.scrollTo({top:0,behavior:"instant"});}));
$$("[data-category]").forEach(b=>b.addEventListener("click",()=>{category=b.dataset.category;$$("[data-category]").forEach(x=>{x.classList.toggle("selected",x===b);x.setAttribute("aria-pressed",String(x===b))});render();}));
$("#search").addEventListener("input",e=>{query=e.target.value;render();});$$(".refresh-action").forEach(b=>b.addEventListener("click",refresh));
function onlineStatus(){const e=$("#online-status");e.replaceChildren(element("i"),document.createTextNode(navigator.onLine?"Online":"Offline · cached"));}window.addEventListener("online",onlineStatus);window.addEventListener("offline",onlineStatus);onlineStatus();
$("#export-brief").addEventListener("click",()=>{if(!brief){note("Create a briefing before exporting it.");return;}const u=URL.createObjectURL(new Blob([JSON.stringify(brief,null,2)],{type:"application/json"})),a=element("a");a.href=u;a.download="research-signal-brief.json";a.click();setTimeout(()=>URL.revokeObjectURL(u),1000);});
$("#import-brief").addEventListener("change",async e=>{const file=e.target.files?.[0];if(!file)return;try{if(file.size>100000)throw new Error("Choose a Research Signal briefing file smaller than 100 KB.");brief=cleanBrief(JSON.parse(await file.text()));persist();view="brief";category="all";query="";$("#search").value="";$$("[data-category]").forEach(b=>b.classList.toggle("selected",b.dataset.category==="all"));render();note("Briefing imported. Saved items were retained.");}catch(err){note(err.message||"That file could not be read.");}finally{e.target.value="";}});
$("#clear-cache").addEventListener("click",()=>$("#clear-dialog").showModal());$("#cancel-clear").addEventListener("click",()=>$("#clear-dialog").close());$("#confirm-clear").addEventListener("click",()=>{try{[CACHE,SAVED,PENDING].forEach(k=>localStorage.removeItem(k));brief=null;saved=[];render();$("#clear-dialog").close();note("The cache on this device was cleared.");}catch{note("The browser could not clear its local storage.");}});
render();
if("serviceWorker" in navigator)navigator.serviceWorker.register("./sw.js",{scope:"./"}).catch(()=>{});
