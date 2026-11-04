const $ = id => document.getElementById(id);
const KEY = "macrosnap-v1";
const defaults = { goals:{calories:1900,protein:180,carbs:150,fat:55}, meals:[], deletedMealIds:[], goalUpdatedAt:0 };
const SYNC_ENABLED_KEY = "macrosnap-sync-enabled";
const SYNC_CODE_KEY = "macrosnap-sync-code";
let state = loadState(), pendingPhoto = null;
let syncInFlight = false, syncQueued = false, syncTimer = null;

function loadState(){
 try{
  const saved=JSON.parse(localStorage.getItem(KEY)||"{}");
  return {...defaults,...saved,goals:{...defaults.goals,...saved.goals},meals:Array.isArray(saved.meals)?saved.meals:[],deletedMealIds:Array.isArray(saved.deletedMealIds)?saved.deletedMealIds:[],goalUpdatedAt:Number(saved.goalUpdatedAt)||0};
 }catch{return structuredClone(defaults)}
}
function persist(sync=true){localStorage.setItem(KEY,JSON.stringify(state));if(sync)scheduleSync()}
function syncEnabled(){return localStorage.getItem(SYNC_ENABLED_KEY)==="true"}
function syncPayload(source){
 return {goals:{...source.goals},goalUpdatedAt:Number(source.goalUpdatedAt)||0,meals:(source.meals||[]).map(m=>({id:m.id,date:m.date,name:m.name,calories:m.calories,protein:m.protein,carbs:m.carbs,fat:m.fat,notes:m.notes||""})).sort((a,b)=>String(a.id).localeCompare(String(b.id))),deletedMealIds:[...new Set(source.deletedMealIds||[])].sort()};
}
function syncFingerprint(source){return JSON.stringify(syncPayload(source))}
function mergeSyncStates(local,remote){
 const deleted=new Set([...(local.deletedMealIds||[]),...(remote.deletedMealIds||[])]),mealsById=new Map();
 for(const meal of [...(remote.meals||[]),...(local.meals||[])]){if(!meal?.id||deleted.has(meal.id))continue;const previous=mealsById.get(meal.id)||{};mealsById.set(meal.id,{...previous,...meal,photo:meal.photo||previous.photo||""})}
 const remoteWins=Number(remote.goalUpdatedAt||0)>=Number(local.goalUpdatedAt||0);
 return {...local,goals:remoteWins?remote.goals:local.goals,goalUpdatedAt:Math.max(Number(local.goalUpdatedAt)||0,Number(remote.goalUpdatedAt)||0),meals:[...mealsById.values()],deletedMealIds:[...deleted]};
}
function setSyncStatus(message){const status=$("syncStatus");if(status)status.textContent=message}
function scheduleSync(delay=500){if(!syncEnabled())return;if(syncInFlight){syncQueued=true;return}clearTimeout(syncTimer);syncTimer=setTimeout(()=>syncWithServer(),delay)}
async function syncWithServer(){
 if(!syncEnabled())return;if(syncInFlight){syncQueued=true;return}
 const code=localStorage.getItem(SYNC_CODE_KEY)||"";if(!code){setSyncStatus("Enter your sync code to connect this device.");return}
 syncInFlight=true;setSyncStatus("Syncing…");
 try{
  const response=await fetch("/.netlify/functions/sync-state",{method:"POST",headers:{"Content-Type":"application/json","X-Macrosnap-Sync-Code":code},body:JSON.stringify(syncPayload(state))});
  if(response.status===401)throw new Error("That sync code was rejected. Check that it matches the code in Netlify.");
  if(response.status===503)throw new Error("Sync is not configured yet. Add MACROSNAP_SYNC_CODE in Netlify, then redeploy.");
  if(!response.ok)throw new Error("Sync could not connect. Try again in a moment.");
  const result=await response.json();if(!result.state)throw new Error("The sync service returned an unexpected response.");
  state=mergeSyncStates(state,result.state);persist(false);update();
  if(syncFingerprint(state)!==syncFingerprint(result.state))syncQueued=true;
  setSyncStatus("Synced. Your meals and goals are shared.");
 }catch(error){setSyncStatus(error.message||"Sync failed. Try again in a moment.")}
 finally{syncInFlight=false;if(syncQueued){syncQueued=false;scheduleSync(0)}}
}
function todayMeals(){const today=new Date().toDateString();return state.meals.filter(m=>new Date(m.date).toDateString()===today)}
function totals(){return todayMeals().reduce((a,m)=>({calories:a.calories+Number(m.calories),protein:a.protein+Number(m.protein),carbs:a.carbs+Number(m.carbs),fat:a.fat+Number(m.fat)}),{calories:0,protein:0,carbs:0,fat:0})}
function fmt(n){return Math.round(n).toLocaleString("en-US")}

const recommendationFoods = [
 {name:"Chicken breast",serving:"4 oz cooked",calories:187,protein:35,carbs:0,fat:4,max:4},
 {name:"Plain Greek yogurt",serving:"170 g",calories:100,protein:17,carbs:6,fat:0,max:4},
 {name:"Cooked rice",serving:"1 cup",calories:205,protein:4,carbs:45,fat:0,max:4},
 {name:"Oats",serving:"1/2 cup dry",calories:150,protein:5,carbs:27,fat:3,max:3},
 {name:"Salmon",serving:"4 oz cooked",calories:233,protein:25,carbs:0,fat:14,max:3},
 {name:"Avocado",serving:"1/2 medium",calories:120,protein:2,carbs:6,fat:11,max:2},
 {name:"Banana",serving:"1 medium",calories:105,protein:1,carbs:27,fat:0,max:3}
];
function remainingTargets(){
 const t=totals(),g=state.goals;
 return {calories:Math.max(0,g.calories-t.calories),protein:Math.max(0,g.protein-t.protein),carbs:Math.max(0,g.carbs-t.carbs),fat:Math.max(0,g.fat-t.fat)};
}
function buildRecommendationPlan(target){
 const sum={calories:0,protein:0,carbs:0,fat:0},counts=Array(recommendationFoods.length).fill(0);
 let best=null;
 function score(servings){
  const dimensions=[["calories",target.calories,0.65,100],["protein",target.protein,1.3,15],["carbs",target.carbs,1.1,15],["fat",target.fat,1.1,10]];
  let value=0;
  dimensions.forEach(([key,goal,weight,floor])=>{const delta=(sum[key]-goal)/Math.max(goal,floor);value+=weight*delta*delta*(delta>0?4:1)});
  return value+servings*0.008;
 }
 function visit(index,servings){
  if(index===recommendationFoods.length){
   if(!servings)return;
   const value=score(servings);
   if(!best||value<best.score)best={score:value,counts:counts.slice(),totals:{...sum}};
   return;
  }
  const food=recommendationFoods[index];
  for(let count=0;count<=food.max;count++){
   counts[index]=count;sum.calories+=food.calories*count;sum.protein+=food.protein*count;sum.carbs+=food.carbs*count;sum.fat+=food.fat*count;
   visit(index+1,servings+count);
   sum.calories-=food.calories*count;sum.protein-=food.protein*count;sum.carbs-=food.carbs*count;sum.fat-=food.fat*count;
  }
 }
 visit(0,0);return best;
}
function renderRecommendations(){
 const remaining=remainingTargets();
 $("remainingCalories").textContent=fmt(remaining.calories);
 $("remainingProtein").textContent=fmt(remaining.protein)+"g";
 $("remainingCarbs").textContent=fmt(remaining.carbs)+"g";
 $("remainingFat").textContent=fmt(remaining.fat)+"g";
 const content=$("recommendationContent");
 if(!remaining.protein&&!remaining.carbs&&!remaining.fat){content.innerHTML='<div class="empty-state"><div class="empty-icon">✓</div><b>Your macro targets are met</b><p>You do not need to eat just to use up remaining calories.</p></div>';return}
 if(!remaining.calories){content.innerHTML='<div class="empty-state"><div class="empty-icon">◎</div><b>You have reached your calorie target</b><p>If you are hungry, choose a light option and adjust your goals as needed.</p></div>';return}
 const plan=buildRecommendationPlan(remaining);
 if(!plan){content.innerHTML='<div class="empty-state"><b>No plan found</b><p>Try adjusting your daily targets in Goals.</p></div>';return}
 const rows=plan.counts.map((count,index)=>{if(!count)return '';const food=recommendationFoods[index];return '<div class="plan-food"><div><b>'+food.name+'</b><small>'+count+' × '+food.serving+'</small></div><span>'+fmt(food.calories*count)+' kcal</span></div>'}).filter(Boolean).join('');
 content.innerHTML='<article class="recommendation-card"><div class="eyebrow">A POSSIBLE REST-OF-DAY PLAN</div><h3>Simple foods to help close the gap</h3><div class="plan-foods">'+rows+'</div><div class="plan-total"><span>Plan estimate</span><b>'+fmt(plan.totals.calories)+' kcal · '+fmt(plan.totals.protein)+'g protein · '+fmt(plan.totals.carbs)+'g carbs · '+fmt(plan.totals.fat)+'g fat</b></div><p class="disclaimer">These are approximate portions, not a food log. Actual nutrition varies by brand and preparation; adjust the portions to fit your appetite.</p></article>';
}
function update(){
 const t=totals(),g=state.goals;
 $("todayLabel").textContent=new Date().toLocaleDateString(undefined,{weekday:"long",month:"short",day:"numeric"});
 $("calConsumed").textContent=fmt(t.calories);$("calGoal").textContent=fmt(g.calories);
 $("calRemaining").textContent=fmt(Math.max(0,g.calories-t.calories));
 $("calBar").style.width=Math.min(100,t.calories/g.calories*100)+"%";
 $("calPercent").textContent=Math.round(t.calories/g.calories*100)+"% completed";
 $("mealCount").textContent=todayMeals().length;$("journalCount").textContent=todayMeals().length+" LOGGED";
 [["p",t.protein,g.protein],["c",t.carbs,g.carbs],["f",t.fat,g.fat]].forEach(([id,v,goal])=>{
  $(id+"Consumed").textContent=fmt(v);$(id+"Goal").textContent=fmt(goal);
  $(id+"Remaining").textContent=fmt(Math.max(0,goal-v))+"g left";
  $(id+"Bar").style.width=Math.min(100,v/goal*100)+"%";
 });
 renderMeals();
 if(!$("recommendationsView").hidden)renderRecommendations();
}
function renderMeals(){
 const list=$("mealList"), meals=todayMeals().sort((a,b)=>new Date(b.date)-new Date(a.date));
 if(!meals.length){list.innerHTML='<div class="empty-state"><div class="empty-icon">🥗</div><b>Your food journal starts here</b><p>Snap a meal photo to add it to today\'s totals.</p></div>';return}
 list.innerHTML=meals.map(m=>`<article class="meal-row"><img class="meal-thumb" src="${m.photo||''}" alt=""><div class="meal-info"><b>${escapeHtml(m.name)}</b><small>P ${fmt(m.protein)}g · C ${fmt(m.carbs)}g · F ${fmt(m.fat)}g</small></div><div class="meal-kcal">${fmt(m.calories)} kcal</div><button class="delete-meal" data-delete="${m.id}" aria-label="Delete meal">×</button></article>`).join("");
 list.querySelectorAll("[data-delete]").forEach(btn=>btn.addEventListener("click",()=>{state.deletedMealIds=[...new Set([...state.deletedMealIds,btn.dataset.delete])];state.meals=state.meals.filter(m=>m.id!==btn.dataset.delete);persist();update()}));
}
function escapeHtml(s){return String(s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]))}
function openPhoto(){$("photoInput").click()}
function openLibrary(){$("libraryInput").click()}
$("captureBtn").addEventListener("click",openPhoto);
if($("libraryBtn"))$("libraryBtn").addEventListener("click",openLibrary);
async function handlePhotoChange(e){
 const file=e.target.files?.[0];if(!file)return;
 pendingPhoto=await resizePhoto(file);$("preview").src=pendingPhoto;
 $("mealName").value="";["mealCalories","mealProtein","mealCarbs","mealFat"].forEach(id=>$(id).value="");
 $("mealNotes").value="";$("aiStatus").textContent="Preparing the resized photo for analysis…";
 $("mealDialog").showModal();
 try{const result=await analyzePhoto(pendingPhoto);fillDraft(result);$("aiStatus").textContent="AI estimate ready — check portions and ingredients, then save."}
 catch(err){$("aiStatus").textContent=err.message+" You can still enter the nutrition manually."}
 e.target.value="";
}
$("photoInput").addEventListener("change",handlePhotoChange);
if($("libraryInput"))$("libraryInput").addEventListener("change",handlePhotoChange);
async function resizePhoto(file){return await new Promise(resolve=>{const img=new Image(),url=URL.createObjectURL(file);img.onload=()=>{const c=document.createElement("canvas"),max=1400,scale=Math.min(1,max/Math.max(img.width,img.height));c.width=Math.round(img.width*scale);c.height=Math.round(img.height*scale);c.getContext("2d").drawImage(img,0,0,c.width,c.height);URL.revokeObjectURL(url);resolve(c.toDataURL("image/jpeg",.82))};img.src=url})}
async function analyzePhoto(imageDataUrl){
 const photo=await (await fetch(imageDataUrl)).blob();
 if(photo.size>4*1024*1024)throw new Error("This photo is still too large after resizing. Please choose a smaller image.");
 const accessCode=localStorage.getItem("macrosnap-access-code")||"";
 const fd=new FormData();fd.append("photo",photo,"meal.jpg");fd.append("date",new Date().toISOString());
 const res=await fetch("/.netlify/functions/analyze-meal",{method:"POST",body:fd,headers:{"X-Macrosnap-Access-Code":accessCode}});
 if(!res.ok){const problem=await res.json().catch(()=>({}));throw new Error(problem.error||"AI service could not analyze this photo.");}
 const d=await res.json();
 for(const k of ["name","calories","proteinGrams","carbsGrams","fatGrams"])if(d[k]===undefined)throw new Error("AI service response is missing nutrition fields.");
 return d;
}
function fillDraft(d){$("mealName").value=d.name;$("mealCalories").value=Math.round(d.calories);$("mealProtein").value=d.proteinGrams;$("mealCarbs").value=d.carbsGrams;$("mealFat").value=d.fatGrams;$("mealNotes").value=d.notes||""}
$("manualBtn").addEventListener("click",()=>{$("aiStatus").textContent="Manual entry selected. Fill in the nutrition values and save."});
$("mealForm").addEventListener("submit",e=>{
 if(e.submitter?.value==="cancel")return;
 e.preventDefault();
 const meal={id:crypto.randomUUID(),date:new Date().toISOString(),name:$("mealName").value.trim(),calories:+$("mealCalories").value,protein:+$("mealProtein").value,carbs:+$("mealCarbs").value,fat:+$("mealFat").value,notes:$("mealNotes").value,photo:pendingPhoto};
 if(!meal.name||![meal.calories,meal.protein,meal.carbs,meal.fat].every(Number.isFinite))return;
 state.meals.push(meal);persist();$("mealDialog").close();pendingPhoto=null;update();
});
function activateTab(tab){
 const isPlan=tab==="recommendations";
 $("todayView").hidden=isPlan;$("recommendationsView").hidden=!isPlan;
 ["todayNav","historyNav","recommendationsNav","goalsNav"].forEach(id=>$(id).classList.toggle("active",id===(isPlan?"recommendationsNav":"todayNav")));
 if(isPlan)renderRecommendations();
}
$("todayNav").addEventListener("click",()=>activateTab("today"));
$("recommendationsNav").addEventListener("click",()=>activateTab("recommendations"));
$("settingsBtn").addEventListener("click",openGoals);$("goalsNav").addEventListener("click",()=>{activateTab("today");openGoals()});
function openGoals(){const g=state.goals;$("goalCalories").value=g.calories;$("goalProtein").value=g.protein;$("goalCarbs").value=g.carbs;$("goalFat").value=g.fat;$("aiAccessCode").value=localStorage.getItem("macrosnap-access-code")||"";if($("syncAccessCode"))$("syncAccessCode").value=localStorage.getItem(SYNC_CODE_KEY)||"";if($("disableSyncBtn"))$("disableSyncBtn").hidden=!syncEnabled();setSyncStatus(syncEnabled()?"Sync is on for this device.":"Sync is off on this device.");$("goalsDialog").showModal()}
if($("enableSyncBtn"))$("enableSyncBtn").addEventListener("click",async()=>{const code=$("syncAccessCode").value.trim();if(code.length<16){setSyncStatus("Use a sync code with at least 16 characters.");return}localStorage.setItem(SYNC_CODE_KEY,code);localStorage.setItem(SYNC_ENABLED_KEY,"true");$("disableSyncBtn").hidden=false;await syncWithServer()});
if($("disableSyncBtn"))$("disableSyncBtn").addEventListener("click",()=>{localStorage.removeItem(SYNC_ENABLED_KEY);localStorage.removeItem(SYNC_CODE_KEY);clearTimeout(syncTimer);$("disableSyncBtn").hidden=true;setSyncStatus("Sync is off here. Your shared data remains on the Netlify site.")});
$("goalsForm").addEventListener("submit",e=>{if(e.submitter?.value==="cancel")return;e.preventDefault();state.goals={calories:+$("goalCalories").value,protein:+$("goalProtein").value,carbs:+$("goalCarbs").value,fat:+$("goalFat").value};state.goalUpdatedAt=Date.now();const accessCode=$("aiAccessCode").value.trim();if(accessCode)localStorage.setItem("macrosnap-access-code",accessCode);else localStorage.removeItem("macrosnap-access-code");persist();$("goalsDialog").close();update()});
$("historyNav").addEventListener("click",()=>{activateTab("today");const all=[...state.meals].sort((a,b)=>new Date(b.date)-new Date(a.date));$("historyContent").innerHTML=all.length?all.map(m=>`<div class="meal-row"><div class="meal-info"><b>${escapeHtml(m.name)}</b><small>${new Date(m.date).toLocaleString()}</small></div><b>${fmt(m.calories)} kcal</b></div>`).join(""):'<p class="disclaimer">No meals logged yet.</p>';$("historyDialog").showModal()});
if("serviceWorker" in navigator && location.protocol.startsWith("http"))navigator.serviceWorker.register("sw.js").catch(()=>{});
window.addEventListener("focus",()=>{if(syncEnabled())syncWithServer()});
document.addEventListener("visibilitychange",()=>{if(document.visibilityState==="visible"&&syncEnabled())syncWithServer()});
setInterval(()=>{if(syncEnabled())syncWithServer()},30000);
update();
if(syncEnabled())syncWithServer();
