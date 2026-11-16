export const SERVICE = "https://research-signal-mohammad.mohammad-sabokrou.chatgpt.site/github";
export const CATEGORIES = {paper:"Research",grant:"Funding",career:"Career",development:"Field notes",debate:"Debate",linkedin:"Public LinkedIn"};
export function safeUrl(raw) {
 try{const u=new URL(raw);if(u.protocol!=="https:"||u.username||u.password||u.port||!u.hostname.includes(".")||/^(127\.|0\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.)/.test(u.hostname)||u.hostname.endsWith(".local")||u.hostname.endsWith(".localhost"))return null;return u.toString();}catch{return null;}
}
export function cleanBrief(value) {
 if(!value||value.version!==1||!Array.isArray(value.items)||value.items.length>10||typeof value.updated!=="string"||!Number.isFinite(Date.parse(value.updated)))throw new Error("That file is not a Research Signal briefing.");
 const seen=new Set();
 const items=value.items.flatMap(x=>{const url=safeUrl(x.url);if(!url||seen.has(url)||!CATEGORIES[x.category]||typeof x.title!=="string"||typeof x.summary!=="string")return [];seen.add(url);return [{url,title:x.title.slice(0,180),summary:x.summary.slice(0,650),why:String(x.why??"").slice(0,240),action:String(x.action??"").slice(0,220),category:x.category,source:new URL(url).hostname.replace(/^www\./,""),score:Math.min(100,Math.max(0,Number(x.score)||0)),deadline:/^\d{4}-\d{2}-\d{2}$/.test(x.deadline??"")?x.deadline:null,published:/^\d{4}-\d{2}-\d{2}$/.test(x.published??"")?x.published:null,eligibility:String(x.eligibility??"").slice(0,260)}];});
 return {version:1,updated:value.updated,items,note:String(value.note??"").slice(0,500)};
}
export function decodeReturn(hash,pending,now=Date.now()) {
 const p=new URLSearchParams(hash.replace(/^#/,""));if(!p.has("brief"))return null;
 if(!pending||now-pending.created>30*60*1000||p.get("state")!==pending.id)throw new Error("This refresh link has expired or belongs to another browser. Refresh again, or import the briefing file from the secure page.");
 const s=p.get("brief");if(s.length>24000)throw new Error("The briefing is too large.");
 try{const bytes=Uint8Array.from(atob(s.replace(/-/g,"+").replace(/_/g,"/")),c=>c.charCodeAt(0));return cleanBrief(JSON.parse(new TextDecoder().decode(bytes)));}catch(e){if(e.message?.includes("Research Signal"))throw e;throw new Error("The returned briefing could not be read. Your previous briefing is retained.");}
}
export function selectItems(brief,saved,{view="brief",category="all",query=""}={}) {
 const today=new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Tashkent"}).format(new Date());
 let items=view==="saved"?saved:brief?.items??[];
 return items.filter(x=>(view==="saved"||!x.deadline||x.deadline>=today)&&(category==="all"||x.category===category)&&(!query||`${x.title} ${x.summary} ${x.why} ${x.source}`.toLowerCase().includes(query.toLowerCase())));
}
