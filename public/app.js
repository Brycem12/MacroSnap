const $ = id => document.getElementById(id);
const KEY = "macrosnap-v1";
const defaults = { goals:{calories:1900,protein:180,carbs:150,fat:55}, meals:[], deletedMealIds:[], savedMeals:[], deletedSavedMealIds:[], goalUpdatedAt:0 };
const SYNC_ENABLED_KEY = "macrosnap-sync-enabled";
const SYNC_CODE_KEY = "macrosnap-sync-code";
let state = loadState(), pendingPhoto = null;
let syncInFlight = false, syncQueued = false, syncTimer = null;

function loadState(){
 try{
  const saved=JSON.parse(localStorage.getItem(KEY)||"{}");
  return {...defaults,...saved,goals:{...defaults.goals,...saved.goals},meals:Array.isArray(saved.meals)?saved.meals:[],deletedMealIds:Array.isArray(saved.deletedMealIds)?saved.deletedMealIds:[],savedMeals:Array.isArray(saved.savedMeals)?saved.savedMeals:[],deletedSavedMealIds:Array.isArray(saved.deletedSavedMealIds)?saved.deletedSavedMealIds:[],goalUpdatedAt:Number(saved.goalUpdatedAt)||0};
 }catch{return structuredClone(defaults)}
}
function persist(sync=true){localStorage.setItem(KEY,JSON.stringify(state));if(sync)scheduleSync()}
function syncEnabled(){return localStorage.getItem(SYNC_ENABLED_KEY)==="true"}
function syncPayload(source){
 return {goals:{...source.goals},goalUpdatedAt:Number(source.goalUpdatedAt)||0,meals:(source.meals||[]).map(m=>({id:m.id,date:m.date,name:m.name,calories:m.calories,protein:m.protein,carbs:m.carbs,fat:m.fat,notes:m.notes||""})).sort((a,b)=>String(a.id).localeCompare(String(b.id))),deletedMealIds:[...new Set(source.deletedMealIds||[])].sort(),savedMeals:(source.savedMeals||[]).map(m=>({id:m.id,name:m.name,serving:m.serving||"1 serving",calories:m.calories,protein:m.protein,carbs:m.carbs,fat:m.fat})).sort((a,b)=>String(a.id).localeCompare(String(b.id))),deletedSavedMealIds:[...new Set(source.deletedSavedMealIds||[])].sort()};
}
function syncFingerprint(source){return JSON.stringify(syncPayload(source))}
function mergeSyncStates(local,remote){
 const deleted=new Set([...(local.deletedMealIds||[]),...(remote.deletedMealIds||[])]),mealsById=new Map();
 for(const meal of [...(remote.meals||[]),...(local.meals||[])]){if(!meal?.id||deleted.has(meal.id))continue;const previous=mealsById.get(meal.id)||{};mealsById.set(meal.id,{...previous,...meal,photo:meal.photo||previous.photo||""})}
 const deletedSaved=new Set([...(local.deletedSavedMealIds||[]),...(remote.deletedSavedMealIds||[])]),savedById=new Map();
 for(const meal of [...(remote.savedMeals||[]),...(local.savedMeals||[])]){if(!meal?.id||deletedSaved.has(meal.id))continue;savedById.set(meal.id,meal)}
 const remoteWins=Number(remote.goalUpdatedAt||0)>=Number(local.goalUpdatedAt||0);
 return {...local,goals:remoteWins?remote.goals:local.goals,goalUpdatedAt:Math.max(Number(local.goalUpdatedAt)||0,Number(remote.goalUpdatedAt)||0),meals:[...mealsById.values()],deletedMealIds:[...deleted],savedMeals:[...savedById.values()],deletedSavedMealIds:[...deletedSaved]};
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
function buildRecommendationPlan(target,foods){
 const counts=Array(foods.length).fill(0),totals={calories:0,protein:0,carbs:0,fat:0};
 const dimensions=[["calories",target.calories,0.65,100],["protein",target.protein,1.3,15],["carbs",target.carbs,1.1,15],["fat",target.fat,1.1,10]];
 const score=(sum,servings)=>{let value=0;dimensions.forEach(([key,goal,weight,floor])=>{const delta=(sum[key]-goal)/Math.max(goal,floor);value+=weight*delta*delta*(delta>0?4:1)});return value+servings*0.008};
 let servings=0,currentScore=score(totals,servings);
 for(let step=0;step<12;step++){
  let choice=null;
  foods.forEach((food,index)=>{
   if(counts[index]>=(Number.isFinite(food.max)?food.max:4))return;
   const next={calories:totals.calories+food.calories,protein:totals.protein+food.protein,carbs:totals.carbs+food.carbs,fat:totals.fat+food.fat};
   const nextScore=score(next,servings+1);
   if(nextScore<currentScore-0.000001&&(!choice||nextScore<choice.score))choice={index,score:nextScore,totals:next};
  });
  if(!choice)break;
  counts[choice.index]++;servings++;currentScore=choice.score;
  Object.assign(totals,choice.totals);
 }
 return servings?{score:currentScore,counts,totals,foods}:null;
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
 const savedTemplates=state.savedMeals||[],usingSaved=savedTemplates.length>0;
 const foods=usingSaved?savedTemplates.map(meal=>({...meal,serving:meal.serving||"1 serving",max:4})):recommendationFoods;
 const plan=buildRecommendationPlan(remaining,foods);
 if(!plan){content.innerHTML='<div class="empty-state"><b>No close plan found</b><p>Try adding another saved meal or adjusting your daily targets.</p></div>';return}
 const rows=plan.counts.map((count,index)=>{if(!count)return '';const food=foods[index];const serving=escapeHtml(food.serving||"1 serving");return '<div class="plan-food"><div><b>'+escapeHtml(food.name)+'</b><small>'+count+' × '+serving+' · P '+fmt(food.protein*count)+'g · C '+fmt(food.carbs*count)+'g · F '+fmt(food.fat*count)+'g</small></div><span>'+fmt(food.calories*count)+' kcal</span></div>'}).filter(Boolean).join('');
 const eyebrow=usingSaved?'A PLAN FROM YOUR SAVED MEALS':'A POSSIBLE REST-OF-DAY PLAN';
 const heading=usingSaved?'Meals you already like':'Simple foods to help close the gap';
 const action=usingSaved?'<button type="button" class="primary-btn full-btn" id="addSavedPlanBtn">Add this plan to today</button>':'<button type="button" class="secondary-btn full-btn" id="openSavedMealsBtn">Save your favorite meals</button>';
 const note=usingSaved?'Uses the serving sizes and macros you saved. Nothing is logged until you tap the button.':'These are approximate portions, not a food log. Actual nutrition varies by brand and preparation.';
 content.innerHTML='<article class="recommendation-card"><div class="eyebrow">'+eyebrow+'</div><h3>'+heading+'</h3><div class="plan-foods">'+rows+'</div><div class="plan-total"><span>Plan estimate</span><b>'+fmt(plan.totals.calories)+' kcal · '+fmt(plan.totals.protein)+'g protein · '+fmt(plan.totals.carbs)+'g carbs · '+fmt(plan.totals.fat)+'g fat</b></div><p class="disclaimer">'+note+'</p><div class="plan-actions">'+action+'</div></article>';
 if(usingSaved)$("addSavedPlanBtn").addEventListener("click",()=>addPlanToToday(plan,foods));
 else $("openSavedMealsBtn").addEventListener("click",()=>activateTab("saved"));
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
 if(!$("savedMealsView").hidden)renderSavedMeals();
}
function renderMeals(){
 const list=$("mealList"), meals=todayMeals().sort((a,b)=>new Date(b.date)-new Date(a.date));
 if(!meals.length){list.innerHTML='<div class="empty-state"><div class="empty-icon">🥗</div><b>Your food journal starts here</b><p>Snap a meal photo to add it to today\'s totals.</p></div>';return}
 list.innerHTML=meals.map(m=>`<article class="meal-row"><img class="meal-thumb" src="${m.photo||''}" alt=""><div class="meal-info"><b>${escapeHtml(m.name)}</b><small>P ${fmt(m.protein)}g · C ${fmt(m.carbs)}g · F ${fmt(m.fat)}g</small></div><div class="meal-kcal">${fmt(m.calories)} kcal</div><button class="delete-meal" data-delete="${m.id}" aria-label="Delete meal">×</button></article>`).join("");
 list.querySelectorAll("[data-delete]").forEach(btn=>btn.addEventListener("click",()=>{state.deletedMealIds=[...new Set([...state.deletedMealIds,btn.dataset.delete])];state.meals=state.meals.filter(m=>m.id!==btn.dataset.delete);persist();update()}));
}
function saveMealTemplate(source,serving="1 portion"){
 const template={id:crypto.randomUUID(),name:String(source.name||"").trim().slice(0,100),serving:String(serving||"1 portion").trim().slice(0,80),calories:Number(source.calories)||0,protein:Number(source.protein)||0,carbs:Number(source.carbs)||0,fat:Number(source.fat)||0};
 const duplicate=(state.savedMeals||[]).some(meal=>meal.name.toLowerCase()===template.name.toLowerCase()&&meal.calories===template.calories&&meal.protein===template.protein&&meal.carbs===template.carbs&&meal.fat===template.fat);
 if(!duplicate)state.savedMeals.push(template);
 return template;
}
function openSavedMealDialog(){
 $("savedMealForm").reset();$("savedMealServing").value="1 serving";$("savedMealDialog").showModal();
}
function logSavedMeal(template){
 state.meals.push({id:crypto.randomUUID(),date:new Date().toISOString(),name:template.name,calories:Number(template.calories),protein:Number(template.protein),carbs:Number(template.carbs),fat:Number(template.fat),notes:"Saved meal · "+(template.serving||"1 serving"),photo:""});
 persist();update();activateTab("today");
}
function addPlanToToday(plan,foods){
 const date=new Date().toISOString();
 plan.counts.forEach((count,index)=>{const template=foods[index];for(let i=0;i<count;i++)state.meals.push({id:crypto.randomUUID(),date,name:template.name,calories:Number(template.calories),protein:Number(template.protein),carbs:Number(template.carbs),fat:Number(template.fat),notes:"Added from Eat plan · "+(template.serving||"1 serving"),photo:""})});
 persist();update();activateTab("today");
}
function renderSavedMeals(){
 const list=$("savedMealsList"),meals=state.savedMeals||[];
 if(!meals.length){list.innerHTML='<div class="empty-state"><div class="empty-icon">☆</div><b>No saved meals yet</b><p>Add a meal and its usual serving macros. You can save one while logging a meal, too.</p><button type="button" class="primary-btn full-btn" id="emptyAddSavedMealBtn">Add a saved meal</button></div>';$("emptyAddSavedMealBtn").addEventListener("click",openSavedMealDialog);return}
 list.innerHTML=meals.map(meal=>'<article class="saved-meal-card"><div class="saved-meal-main"><div><b>'+escapeHtml(meal.name)+'</b><small>'+escapeHtml(meal.serving||"1 serving")+'</small></div><span>'+fmt(meal.calories)+' kcal</span></div><div class="saved-meal-macros">P '+fmt(meal.protein)+'g · C '+fmt(meal.carbs)+'g · F '+fmt(meal.fat)+'g</div><div class="saved-meal-actions"><button type="button" class="primary-btn" data-use-saved="'+escapeHtml(meal.id)+'">Add to today</button><button type="button" class="secondary-btn" data-delete-saved="'+escapeHtml(meal.id)+'">Delete</button></div></article>').join("");
 list.querySelectorAll("[data-use-saved]").forEach(button=>button.addEventListener("click",()=>{const meal=meals.find(item=>item.id===button.dataset.useSaved);if(meal)logSavedMeal(meal)}));
 list.querySelectorAll("[data-delete-saved]").forEach(button=>button.addEventListener("click",()=>{const id=button.dataset.deleteSaved;state.deletedSavedMealIds=[...new Set([...(state.deletedSavedMealIds||[]),id])];state.savedMeals=state.savedMeals.filter(meal=>meal.id!==id);persist();update()}));
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
 $("mealNotes").value="";$("saveAsTemplate").checked=false;$("aiStatus").textContent="Preparing the resized photo for analysis…";
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
 state.meals.push(meal);if($("saveAsTemplate").checked)saveMealTemplate(meal,"1 portion");persist();$("mealDialog").close();pendingPhoto=null;update();
});
$("savedMealForm").addEventListener("submit",e=>{
 if(e.submitter?.value==="cancel")return;
 e.preventDefault();
 const template={id:crypto.randomUUID(),name:$("savedMealName").value.trim(),serving:$("savedMealServing").value.trim()||"1 serving",calories:+$("savedMealCalories").value,protein:+$("savedMealProtein").value,carbs:+$("savedMealCarbs").value,fat:+$("savedMealFat").value};
 if(!template.name||![template.calories,template.protein,template.carbs,template.fat].every(Number.isFinite))return;
 state.savedMeals.push(template);persist();$("savedMealDialog").close();update();activateTab("saved");
});
function activateTab(tab){
 const isPlan=tab==="recommendations",isSaved=tab==="saved";
 $("todayView").hidden=isPlan||isSaved;$("recommendationsView").hidden=!isPlan;$("savedMealsView").hidden=!isSaved;
 const active=isPlan?"recommendationsNav":isSaved?"savedMealsNav":"todayNav";
 ["todayNav","recommendationsNav","savedMealsNav","historyNav","goalsNav"].forEach(id=>$(id).classList.toggle("active",id===active));
 if(isPlan)renderRecommendations();
 if(isSaved)renderSavedMeals();
}
$("todayNav").addEventListener("click",()=>activateTab("today"));
$("recommendationsNav").addEventListener("click",()=>activateTab("recommendations"));
$("savedMealsNav").addEventListener("click",()=>activateTab("saved"));
$("addSavedMealBtn").addEventListener("click",openSavedMealDialog);
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
