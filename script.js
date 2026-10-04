const KEY="myRecipeNoteV1";
const PREPARATION_KEY="todayPrepMemo";
const LEGACY_PREPARATION_KEY="restaurantRecipeNoteTodayV1";
const $=id=>document.getElementById(id);

/* Purchase unlock is a device entitlement, not recipe data: kept out of `state` so backup export/import never touches it. */
const PURCHASE_KEY="recipeNoteUnlocked";
const FREE_RECIPE_LIMIT=20;
const PURCHASE_PRICE_LABEL="800円";
let purchaseUnlocked=false;
let purchaseBusy=false;

/* Fill in once the app is live in App Store Connect (App Information → Apple ID, the numeric id in the app's App Store URL). */
const APP_STORE_APP_ID="";

const SERVING_MULT={"1人前":1,"5人前":5,"10人前":10,"1回分":1,"1.5回分":1.5,"2回分":2};
const backTargets={categoryView:"homeView",recipeDetailView:"categoryView",categoryEditView:"categoryView",settingsView:"homeView",supportView:"settingsView",preparationView:"homeView",seasonView:"homeView"};
let preparationDay="";
let preparationTimer;
let preparationDirty=false;
let appInitialized=false;

/* Photos live in IndexedDB; localStorage keeps only "idb:<key>" references. */
const IMAGE_DB="recipeNoteImages",IMAGE_STORE="images",IMAGE_REF="idb:";
let imageDb=null;
const imageCache=new Map(),imageKeys=new Map();
let loadProblem=false;

let state=defaultState();
let currentCategoryId=null;
let currentRecipeId=null;
let currentView="homeView";
const MONTHS=Array.from({length:12},(_,i)=>String(i+1));
const SEASONS=["春","夏","秋","冬"];
const UNITS=["","g","kg","ml","L","個","本","枚","人前","回分","袋","束","大さじ","小さじ","少々","適量"];
const YIELD_UNITS=["人前","回分","バット","鍋","ボウル","個","本","kg","g","L","ml"];
const SHOP_PRESETS={
  restaurant:{name:"飲食店",categories:["前菜・小鉢","サラダ","主菜・メイン","副菜・付け合わせ","ご飯・麺","汁物・スープ","だし・ソース・たれ","デザート"],units:["g","ml","個","本"]},
  bakery:{name:"パン屋",categories:["食パン","食事パン","惣菜パン","菓子パン","生地","フィリング・具材"],units:["g","kg","個"]},
  pastry:{name:"菓子店",categories:["ケーキ","焼き菓子","冷菓","和菓子","生地","クリーム・フィリング"],units:["g","ml","個","枚"]},
  cafe:{name:"カフェ・喫茶店",categories:["コーヒー・お茶","その他のドリンク","軽食","デザート","シロップ・ソース"],units:["ml","g","個","L"]},
  deli:{name:"惣菜・弁当店",categories:["弁当","主菜・メイン","副菜・付け合わせ","ご飯・おにぎり","揚げ物","だし・ソース・たれ"],units:["g","kg","個","人前"]},
  other:{name:"その他・自分で設定",categories:[],units:[]}
};
let shopSettingsReturnView="homeView";
let selectedMonths=[],selectedSeasons=[];
let formAttachments=[];
let imageJobs=0,formSession=0;
let prepFeedbackTimer;
let modalReturnFocus;
let formPhoto="";
let formStages=[];

function defaultState(){
  return{
    categories:[],
    recipes:[]
  };
}
function load(){
  let raw;
  try{raw=localStorage.getItem(KEY);}catch{loadProblem=true;alert("ブラウザの保存領域を利用できません。保存設定をご確認ください。");return defaultState();}
  if(!raw)return defaultState();
  loadProblem=true;
  try{
    const x=JSON.parse(raw);
    if(x&&Array.isArray(x.categories)&&Array.isArray(x.recipes)){
      migrateRecipes(x);
      resolveImageRefs(x);
      loadProblem=false;
      return x;
    }
    saveBrokenCopy(raw);
    alert("保存されていたデータの形式が読み取れませんでした。元のデータは別名で端末内に残していますが、開発者にご連絡ください。");
    return defaultState();
  }catch(e){
    saveBrokenCopy(raw);
    alert("保存データの読み込み中にエラーが発生しました。元のデータは別名で端末内に残していますが、開発者にご連絡ください。\nエラー内容："+(e&&e.message?e.message:e));
    return defaultState();
  }
}
function saveBrokenCopy(raw){
  try{localStorage.setItem(KEY+"_broken_"+Date.now(),raw);}catch{}
}
function migrateRecipes(x){
  x.recipes.forEach(r=>{
    if(typeof r.ingredients==="string"){
      r.ingredients=r.ingredients.split("\n").map(s=>s.trim()).filter(Boolean).map(line=>{
        const parts=line.split(/[\t　]{1,}| {2,}/).filter(Boolean);
        return{name:parts[0]||line,amount:parts.slice(1).join(" ")||""};
      });
    }
    if(!r.servingBase||!SERVING_MULT[r.servingBase])r.servingBase="1人前";
    if(!Array.isArray(r.stages)){
      const ingredients=Array.isArray(r.ingredients)?r.ingredients:[];
      const instruction=typeof r.steps==="string"?r.steps:"";
      r.stages=(ingredients.length||instruction)?[{groupName:"",ingredients,instruction}]:[];
    }
    r.stages.forEach(s=>{
      if(!Array.isArray(s.ingredients))s.ingredients=[];
      if(typeof s.instruction!=="string")s.instruction="";
      if(typeof s.groupName!=="string")s.groupName="";
      if(!Array.isArray(s.images))s.images=[];
    });
    delete r.ingredients;
    delete r.steps;
  });
}
function save(){
  try{
    localStorage.setItem(KEY,serializeState(state));
    return true;
  }catch(e){
    state=load();
    alert("データの保存に失敗しました。空き容量が足りない可能性があります。写真の枚数を減らすか、不要なレシピを削除してから、もう一度お試しください。\nエラー内容："+(e&&e.message?e.message:e));
    return false;
  }
}

/* ---------- photo storage (IndexedDB) ---------- */
function rememberImage(key,url){imageCache.set(key,url);imageKeys.set(url,key);}
function isInlineImage(v){return typeof v==="string"&&v.startsWith("data:image/");}
function recipeImages(s){return s.recipes.flatMap(r=>[r.photo,...(Array.isArray(r.attachments)?r.attachments:[]),...(r.stages||[]).flatMap(stage=>Array.isArray(stage.images)?stage.images:[])]).filter(Boolean);}
function serializeState(s){
  return JSON.stringify(s,(k,v)=>typeof v==="string"&&imageKeys.has(v)?IMAGE_REF+imageKeys.get(v):v);
}
function resolveImageRefs(x){
  // Unresolved refs are kept as-is so a later save never drops them.
  let missing=0;
  const resolve=v=>{
    if(typeof v!=="string"||!v.startsWith(IMAGE_REF))return v;
    const url=imageCache.get(v.slice(IMAGE_REF.length));
    if(url)return url;
    missing++;return v;
  };
  x.recipes.forEach(r=>{
    if(r.photo)r.photo=resolve(r.photo);
    if(Array.isArray(r.attachments))r.attachments=r.attachments.map(resolve);
    (r.stages||[]).forEach(stage=>{if(Array.isArray(stage.images))stage.images=stage.images.map(resolve);});
  });
  return missing;
}
function idbRequest(req){return new Promise((resolve,reject)=>{req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);});}
function openImageDb(){
  return new Promise(resolve=>{
    let done=false;
    const finish=db=>{if(!done){done=true;resolve(db);}else db?.close();};
    if(!window.indexedDB)return finish(null);
    setTimeout(()=>finish(null),5000);
    try{
      const req=indexedDB.open(IMAGE_DB,1);
      req.onupgradeneeded=()=>req.result.createObjectStore(IMAGE_STORE);
      req.onsuccess=()=>finish(req.result);
      req.onerror=()=>finish(null);
    }catch{finish(null);}
  });
}
async function loadImageCache(){
  imageDb=await openImageDb();
  if(!imageDb)return;
  try{
    const store=imageDb.transaction(IMAGE_STORE,"readonly").objectStore(IMAGE_STORE);
    const [keys,values]=await Promise.all([idbRequest(store.getAllKeys()),idbRequest(store.getAll())]);
    keys.forEach((key,i)=>rememberImage(key,values[i]));
  }catch{imageDb=null;}
}
/* Resolves true when every inline image is in IndexedDB; false means they stay inline in localStorage. */
function putImages(urls){
  const pending=[...new Set(urls)].filter(url=>isInlineImage(url)&&!imageKeys.has(url));
  if(!pending.length)return Promise.resolve(true);
  if(!imageDb)return Promise.resolve(false);
  return new Promise(resolve=>{
    try{
      const entries=pending.map(url=>[id(),url]);
      const tx=imageDb.transaction(IMAGE_STORE,"readwrite");
      const store=tx.objectStore(IMAGE_STORE);
      entries.forEach(([key,url])=>store.put(url,key));
      tx.oncomplete=()=>{entries.forEach(([key,url])=>rememberImage(key,url));resolve(true);};
      tx.onerror=tx.onabort=()=>resolve(false);
    }catch{resolve(false);}
  });
}
function referencedImageKeys(){
  const used=new Set(recipeImages(state).map(v=>imageKeys.get(v)||(String(v).startsWith(IMAGE_REF)?String(v).slice(IMAGE_REF.length):"")).filter(Boolean));
  // Keep images referenced by broken-data copies so they can still be recovered.
  try{
    for(let i=0;i<localStorage.length;i++){
      const name=localStorage.key(i);
      if(!name?.startsWith(KEY+"_broken_"))continue;
      for(const m of (localStorage.getItem(name)||"").matchAll(/"idb:([^"]+)"/g))used.add(m[1]);
    }
  }catch{return null;}
  return used;
}
function removeUnusedImages(){
  if(!imageDb||loadProblem)return;
  const used=referencedImageKeys();
  if(!used)return;
  const unused=[...imageCache.keys()].filter(key=>!used.has(key));
  if(!unused.length)return;
  try{
    const tx=imageDb.transaction(IMAGE_STORE,"readwrite");
    const store=tx.objectStore(IMAGE_STORE);
    unused.forEach(key=>store.delete(key));
    tx.oncomplete=()=>unused.forEach(key=>{imageKeys.delete(imageCache.get(key));imageCache.delete(key);});
  }catch{}
}
async function moveInlineImagesToDb(){
  const inline=recipeImages(state).filter(isInlineImage);
  if(!inline.length||!imageDb)return;
  if(await putImages(inline))save();
}
async function startApp(){
  purchaseUnlocked=loadPurchaseStatus();
  await loadImageCache();
  state=load();
  const missing=loadProblem?0:recipeImages(state).filter(v=>String(v).startsWith(IMAGE_REF)).length;
  // Clean up before any user action so an in-flight save can never lose its new images.
  if(!missing)removeUnusedImages();
  init();
  if(missing)alert("一部の写真を読み込めませんでした（"+missing+"枚）。レシピの文章や材料はそのまま残っています。");
  moveInlineImagesToDb();
}
function id(){return crypto.randomUUID?crypto.randomUUID():Date.now()+"-"+Math.random().toString(16).slice(2);}
function esc(s){return String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));}

/* ---------- purchase (free tier limit + IAP bridge) ---------- */
function loadPurchaseStatus(){
  try{return localStorage.getItem(PURCHASE_KEY)==="1";}catch{return false;}
}
function savePurchaseStatus(unlocked){
  purchaseUnlocked=unlocked;
  try{localStorage.setItem(PURCHASE_KEY,unlocked?"1":"0");}catch{}
}
function canAddRecipe(){return purchaseUnlocked||state.recipes.length<FREE_RECIPE_LIMIT;}
function openNewRecipeForm(){
  if(!canAddRecipe()){openPurchaseModal();return false;}
  openRecipeForm(null);
  return true;
}
function openPurchaseModal(){
  renderPurchaseSummary();
  $("purchaseStatus").textContent="";
  openModal("purchase");
}
function renderPurchaseSummary(){
  const count=state.recipes.length;
  $("purchaseSummary").textContent=purchaseUnlocked?"購入済みです。登録できるレシピ件数の上限はありません。":`無料版：レシピは${FREE_RECIPE_LIMIT}件まで登録できます（現在${count}件）。`;
  $("purchaseRecipeCount").textContent=purchaseUnlocked?"購入済みです。":`現在の登録件数：${count} / ${FREE_RECIPE_LIMIT}件`;
  $("openPurchaseButton").textContent=purchaseUnlocked?"プレミアムの詳細":`プレミアムにアップグレード（${PURCHASE_PRICE_LABEL}）`;
  $("purchaseBuyButton").classList.toggle("hidden",purchaseUnlocked);
}
function setPurchaseBusy(){
  $("purchaseBuyButton").disabled=purchaseBusy;
  $("purchaseRestoreButton").disabled=purchaseBusy;
}
/* Posts to the native iOS wrapper's WKScriptMessageHandler (registered as "purchase"); returns false when no native bridge is present, e.g. plain browser testing. */
function postToNative(action){
  const handler=window.webkit?.messageHandlers?.purchase;
  if(!handler)return false;
  try{handler.postMessage({action});return true;}
  catch{return false;}
}
function requestPurchase(){
  if(purchaseBusy||purchaseUnlocked)return;
  purchaseBusy=true;setPurchaseBusy();
  $("purchaseStatus").textContent="";
  if(!postToNative("purchase")){
    purchaseBusy=false;setPurchaseBusy();
    $("purchaseStatus").textContent="このアプリ版では購入できません。App Store版でお試しください。";
  }
}
function requestRestore(){
  if(purchaseBusy)return;
  purchaseBusy=true;setPurchaseBusy();
  $("purchaseStatus").textContent="";
  if(!postToNative("restore")){
    purchaseBusy=false;setPurchaseBusy();
    $("purchaseStatus").textContent="このアプリ版では復元できません。App Store版でお試しください。";
  }
}
/* The following are called from Swift via evaluateJavaScript after StoreKit confirms a result. */
window.onPurchaseUnlocked=function(){
  purchaseBusy=false;
  savePurchaseStatus(true);
  setPurchaseBusy();
  $("purchaseStatus").textContent="購入が完了しました。登録件数の上限はありません。";
  renderPurchaseSummary();
};
window.onPurchaseRestored=function(found){
  purchaseBusy=false;
  if(found){
    savePurchaseStatus(true);
    $("purchaseStatus").textContent="購入内容を復元しました。";
  }else{
    $("purchaseStatus").textContent="復元できる購入が見つかりませんでした。";
  }
  setPurchaseBusy();
  renderPurchaseSummary();
};
window.onPurchaseFailed=function(message){
  purchaseBusy=false;
  setPurchaseBusy();
  $("purchaseStatus").textContent=message||"購入処理を完了できませんでした。もう一度お試しください。";
};

/* Apple's guidance: a button the user explicitly tapped to review should open the App Store listing directly, not SKStoreReviewController (that ambient prompt is OS-throttled and may silently no-op). */
function openAppStoreReview(){
  if(!APP_STORE_APP_ID){
    alert("このアプリはまだApp Storeに公開されていません。公開後にこちらから評価していただけます。");
    return;
  }
  window.open("https://apps.apple.com/app/id"+APP_STORE_APP_ID+"?action=write-review","_blank","noopener,noreferrer");
}

/* Dev/testing-only: tap the version line 7× to toggle the unlock flag without a real purchase. Remove before the real App Store submission build. */
let versionTapCount=0,versionTapTimer=null;
function onVersionLabelTap(){
  versionTapCount++;
  clearTimeout(versionTapTimer);
  versionTapTimer=setTimeout(()=>{versionTapCount=0;},1500);
  if(versionTapCount<7)return;
  versionTapCount=0;
  savePurchaseStatus(!purchaseUnlocked);
  renderPurchaseSummary();
  alert(purchaseUnlocked?"テスト用に登録件数の上限を解除しました。":"テスト解除を元に戻しました（無料版の状態）。");
}

function formatNumber(n){
  const rounded=Math.round(n*100)/100;
  return Number.isInteger(rounded)?String(rounded):String(rounded);
}
function ingredientHistory(){
  const names=new Set(),amounts=new Set();
  state.recipes.forEach(r=>(r.stages||[]).forEach(s=>(s.ingredients||[]).forEach(i=>{
    if(i.name)names.add(i.name);
    if(i.amount)amounts.add(i.amount);
  })));
  return{names:[...names],amounts:[...amounts]};
}
function filterHistory(arr,q){
  const query=q.trim();
  if(!query)return arr.slice(0,8);
  return arr.filter(v=>v.includes(query)).slice(0,8);
}
function setupAutocomplete(input,listEl,historyArr,onChange){
  function renderList(){
    const matches=filterHistory(historyArr,input.value);
    if(!matches.length){listEl.classList.add("hidden");listEl.innerHTML="";return;}
    listEl.innerHTML=matches.map(m=>`<li>${esc(m)}</li>`).join("");
    listEl.classList.remove("hidden");
  }
  input.addEventListener("input",()=>{onChange(input.value);renderList();});
  input.addEventListener("focus",renderList);
  input.addEventListener("blur",()=>{listEl.classList.add("hidden");});
  listEl.addEventListener("mousedown",e=>{
    const li=e.target.closest("li");
    if(!li)return;
    e.preventDefault();
    input.value=li.textContent;
    onChange(input.value);
    listEl.classList.add("hidden");
  });
}

function init(){
  if(appInitialized)return;
  appInitialized=true;
  bind();
  loadPreparationMemo();
  refreshPreparationDate();
  schedulePreparationDate();
  renderCategoryList();
  showView("homeView");
  updateShopSettingsSummary();
  if(!state.shopSettings?.completed)openShopSettings("homeView");
}

function bind(){
  $("shareRecipeButton").onclick=shareCurrentRecipe;
  $("pdfRecipeButton").onclick=previewRecipePdf;
  $("printRecipeButton").onclick=printRecipePdf;
  $("openShopSettings").onclick=()=>openShopSettings("settingsView");
  $("shopSettingsNext").onclick=previewShopCategories;
  $("shopSettingsPrevious").onclick=()=>{
    $("shopCategoryStep").classList.add("hidden");$("shopIndustryStep").classList.remove("hidden");
    $("shopSettingsStatus").textContent="";
  };
  $("shopSettingsForm").onsubmit=saveShopSettings;
  $("skipShopSettings").onclick=leaveShopSettings;
  document.querySelectorAll("[data-home-action]").forEach(card=>{
    card.onclick=()=>{
      const action=card.dataset.homeAction;
      if(action==="recipes"){
        renderCategoryList();
        showView("categoryView");
      }else if(action==="new"){
        openNewRecipeForm();
      }else if(action==="preparation"){
        refreshPreparationDate();
        showView("preparationView");
        const input=$("preparationRows").querySelector(".name-input");
        input.focus();
        input.setSelectionRange(input.value.length,input.value.length);
      }else if(action==="season"){
        showView("seasonView");
      }
    };
  });
  $("backButton").onclick=()=>{
    // Leaving first-run setup by "‹" must count as "あとで設定する", or setup reappears on every launch.
    if(currentView==="shopSettingsView"){leaveShopSettings();return;}
    const target=backTargets[currentView];
    if(target){
      if(target==="categoryView")renderCategoryList();
      showView(target);
    }
  };
  $("gearButton").onclick=()=>{
    backTargets.settingsView=currentView;
    showView("settingsView");
  };
  $("preparationForm").onsubmit=savePreparation;
  $("preparationText").oninput=prepDirty;
  $("addPreparationRow").onclick=()=>{addPreparationRow();prepDirty();$("preparationRows").lastElementChild.querySelector("input").focus();};
  $("deletePreparationButton").onclick=()=>$("deletePreparationDialog").showModal();
  $("cancelPreparationDelete").onclick=()=>$("deletePreparationDialog").close();
  $("confirmPreparationDelete").onclick=deletePreparationMemo;
  $("recipeYieldUnit").onchange=syncYieldCustom;
  bindFilterControls();
  $("manageCategories").onclick=()=>{backTargets.categoryEditView="settingsView";renderCategoryEditList();showView("categoryEditView");};
  $("addRecipeCategory").onclick=addRecipeCategory;
  $("openSupport").onclick=()=>showView("supportView");
  $("rateAppButton").onclick=openAppStoreReview;
  $("versionLabel").onclick=onVersionLabelTap;
  document.querySelectorAll("[data-import-recipe]").forEach(b=>b.onclick=()=>{if(!openNewRecipeForm())return;const target=b.dataset.importRecipe==="images"?$("recipeAttachmentsInput"):$("recipeSourceText");target.focus();target.scrollIntoView({block:"center"});});
  $("recipeSearch").oninput=renderRecipeList;
  $("clearRecipeFilters").onclick=()=>{selectedMonths=[];selectedSeasons=[];currentCategoryId=null;$("recipeSearch").value="";renderFilters();renderCategoryList();};
  $("recipeAttachmentsInput").onchange=onAttachmentsChange;
  renderFilters();
  document.addEventListener("keydown",e=>{
    if(e.key!=="Escape")return;
    if(!$("recipeFormModal").classList.contains("hidden"))closeModal("recipeForm");
    else if(!$("purchaseModal").classList.contains("hidden"))closeModal("purchase");
  });
  const resume=()=>{refreshPreparationDate();schedulePreparationDate();};
  window.addEventListener("focus",resume);
  window.addEventListener("pageshow",resume);
  document.addEventListener("visibilitychange",()=>{if(!document.hidden)resume();});
  window.addEventListener("storage",e=>{
    if(e.key===PREPARATION_KEY||e.key===null){
      if(preparationDirty){$("preparationStatus").textContent="別の画面で保存内容が変わりました。入力中の内容は残っています。";return;}
      restorePreparation(e.newValue);
      $("preparationStatus").textContent="保存内容を更新しました。";
    }
  });
  $("seasonSearchForm").onsubmit=e=>{
    const ingredient=$("seasonIngredient").value.trim();
    if(!ingredient){e.preventDefault();$("seasonIngredient").value="";$("seasonIngredient").reportValidity();return;}
    $("seasonSearchQuery").value=ingredient+" レシピ";
  };
  $("seasonRegisterButton").onclick=()=>{
    if(!openNewRecipeForm())return;
    const ingredient=$("seasonIngredient").value.trim();
    if(ingredient){formStages[0].ingredients[0].name=ingredient;renderStages();}
  };
  $("addRecipeButton").onclick=()=>openNewRecipeForm();
  $("editRecipeButton").onclick=()=>openRecipeForm(findRecipe(currentRecipeId));
  $("deleteRecipeButton").onclick=deleteCurrentRecipe;
  $("addCategoryButton").onclick=addCategory;
  $("newCategoryName").addEventListener("keydown",e=>{if(e.key==="Enter"){e.preventDefault();addCategory();}});
  $("recipeForm").onsubmit=saveRecipeForm;
  $("recipePhotoInput").addEventListener("change",onPhotoChange);
  $("removePhotoButton").onclick=()=>{formPhoto="";renderPhotoPreview();};
  $("addStageButton").onclick=addStage;
  $("exportButton").onclick=exportBackup;
  $("importInput").onchange=importBackup;
  $("openPurchaseButton").onclick=openPurchaseModal;
  $("purchaseBuyButton").onclick=requestPurchase;
  $("purchaseRestoreButton").onclick=requestRestore;
  document.querySelectorAll("[data-close]").forEach(x=>x.onclick=()=>closeModal(x.dataset.close));
}

function showView(name){
  document.body.classList.toggle("recipe-print-preview",name==="recipePrintView");
  document.querySelectorAll(".view").forEach(v=>v.classList.add("hidden"));
  $(name).classList.remove("hidden");
  currentView=name;
  $("backButton").classList.toggle("hidden",name==="homeView");
  $("gearButton").classList.toggle("hidden",name!=="homeView"&&name!=="categoryView");
  $("appBrandIcon").classList.toggle("hidden",name!=="homeView");
  $("headerTagline").classList.toggle("hidden",name!=="homeView");
  document.body.classList.toggle("is-home",name==="homeView");
  const titles={homeView:"飲食店レシピ帳",categoryView:"レシピ一覧",recipeDetailView:(findRecipe(currentRecipeId)||{}).name||"",categoryEditView:"カテゴリー管理",settingsView:"設定",supportView:"使い方・サポート",preparationView:"次回の仕込み",seasonView:"季節の食材を検索"};
  $("headerTitle").textContent=name==="shopSettingsView"?"お店設定":titles[name]||"飲食店レシピ帳";
  $("headerTitle").focus({preventScroll:true});
  window.scrollTo(0,0);
  if(name==="settingsView")renderPurchaseSummary();
}

/* One persistent plain-text memo. Dates are presentation only; no history or snapshots. */
function localDay(date=new Date()){
  return [date.getFullYear(),String(date.getMonth()+1).padStart(2,"0"),String(date.getDate()).padStart(2,"0")].join("-");
}
function refreshPreparationDate(){
  const now=new Date(),today=localDay(now);
  if(preparationDay===today)return;
  preparationDay=today;
  $("preparationDate").dateTime=today;
  $("preparationDate").textContent=new Intl.DateTimeFormat("ja-JP",{year:"numeric",month:"long",day:"numeric",weekday:"long"}).format(now);
}
function schedulePreparationDate(){
  clearTimeout(preparationTimer);
  const now=new Date(),midnight=new Date(now.getFullYear(),now.getMonth(),now.getDate()+1);
  preparationTimer=setTimeout(()=>{refreshPreparationDate();schedulePreparationDate();},midnight-now+50);
}
function savePreparation(e){
  e.preventDefault();
  refreshPreparationDate();
  clearTimeout(prepFeedbackTimer);
  try{
    localStorage.setItem(PREPARATION_KEY,JSON.stringify(readPreparation()));
    localStorage.removeItem(LEGACY_PREPARATION_KEY);
    preparationDirty=false;
    $("preparationSaveButton").textContent="✓ 保存しました";
    $("preparationStatus").textContent=new Intl.DateTimeFormat("ja-JP",{hour:"2-digit",minute:"2-digit"}).format(new Date())+" 保存済み";
    prepFeedbackTimer=setTimeout(()=>{$("preparationSaveButton").textContent="保存";},3000);
  }catch{
    $("preparationSaveButton").textContent="再度保存する";
    $("preparationStatus").textContent="保存を完了できませんでした。入力内容は残っています。空き容量やブラウザ設定を確認してください。";
  }
}

function categoryName(catId){return state.categories.find(c=>c.id===catId)?.name||"";}
function findRecipe(rid){return state.recipes.find(r=>r.id===rid);}
function recipesInCategory(catId){return state.recipes.filter(r=>r.categoryId===catId);}

/* ---------- category sidebar ---------- */
function renderCategoryList(){
  if(currentCategoryId&&!state.categories.some(c=>c.id===currentCategoryId))currentCategoryId=null;
  $("categoryList").innerHTML=[{id:null,name:"すべて"},...state.categories,{id:"",name:"未分類"}].map(c=>
    '<li><button type="button" data-id="'+esc(c.id||"")+'" data-all="'+(c.id===null)+'" aria-pressed="'+(c.id===currentCategoryId)+'">'+esc(c.name)+'</button></li>'
  ).join("");
  $("categoryList").querySelectorAll("button").forEach(b=>b.onclick=()=>openCategory(b.dataset.all==="true"?null:b.dataset.id));
  renderRecipeList();
}
function openCategory(catId){
  currentCategoryId=catId;
  renderCategoryList();
  $("categoryList").querySelector('[aria-pressed="true"]')?.focus({preventScroll:true});
}

/* ---------- recipe list ---------- */
function renderRecipeList(){
  const normalize=v=>String(v||"").normalize("NFKC").toLocaleLowerCase();
  const terms=normalize($("recipeSearch").value).trim().split(/\s+/).filter(Boolean);
  const recipes=state.recipes.filter(r=>{
    const haystack=normalize(r.name);
    return (currentCategoryId===null||(currentCategoryId===""?!r.categoryId:r.categoryId===currentCategoryId))&&matchesTags(r.months,selectedMonths,MONTHS)&&matchesTags(r.seasons,selectedSeasons,SEASONS)&&terms.every(t=>haystack.includes(t));
  });
  $("recipeResultCount").textContent=recipes.length+"件";
  $("recipeListEmpty").textContent=state.recipes.length?"条件に合うレシピがありません。":"まだレシピがありません。";
  $("recipeListEmpty").classList.toggle("hidden",recipes.length>0);
  $("recipeList").innerHTML=recipes.map(r=>{
    const photo=r.photo||r.attachments?.[0];
    const thumb=photo?'<img class="recipe-thumb" src="'+esc(photo)+'" alt="">':'<div class="recipe-thumb-placeholder" aria-hidden="true">▤</div>';
    return '<li><button class="recipe-row-button" type="button" data-id="'+esc(r.id)+'"><span class="recipe-row-main">'+thumb+'<span class="recipe-name">'+esc(r.name)+'</span></span><span aria-hidden="true">›</span></button></li>';
  }).join("");
  $("recipeList").querySelectorAll("button").forEach(b=>b.onclick=()=>openRecipeDetail(b.dataset.id));
}

/* ---------- recipe detail ---------- */
function openRecipeDetail(rid){
  const r=findRecipe(rid);
  if(!r)return;
  currentRecipeId=rid;
  $("recipeExportStatus").textContent="";
  $("detailPhotoWrap").classList.toggle("hidden",!r.photo);
  if(r.photo)$("detailPhoto").src=r.photo;
  $("detailName").textContent=r.name;
  $("detailTags").textContent=[...(r.months||[]).map(m=>m==="all"?"通年":m+"月"),...(r.seasons||[]).map(v=>v==="all"?"通年":v)].join(" ・ ");
  $("detailDate").textContent=r.cookedDate?`作った日：${r.cookedDate}`:"";
  $("detailTime").textContent=r.cookTime?`調理時間：${esc(r.cookTime)}`:"";

  const stages=r.stages||[];
  const hasIngredients=stages.some(s=>(s.ingredients||[]).length>0);
  const base=recipeYield(r);
  $("detailYieldQuantity").value=base.quantity;
  $("detailYieldUnit").innerHTML=unitOptions(compatibleUnits(base.unit),base.unit);
  $("detailYieldQuantity").oninput=()=>renderDetailStages(r);
  $("detailYieldUnit").onchange=()=>renderDetailStages(r);
  $("detailServingWrap").classList.toggle("hidden",!hasIngredients);

  $("detailStagesWrap").classList.toggle("hidden",!stages.length);
  renderDetailStages(r);

  $("detailMemoWrap").classList.toggle("hidden",!r.memo);
  $("detailMemo").textContent=r.memo||"";
  $("detailSourceWrap").classList.toggle("hidden",!r.sourceText&&!r.attachments?.length);
  $("detailSourceText").textContent=r.sourceText||"";
  $("detailAttachments").innerHTML=(r.attachments||[]).map((src,i)=>'<a href="'+esc(src)+'" download="レシピ画像-'+(i+1)+'.jpg"><img src="'+esc(src)+'" alt="添付レシピ '+(i+1)+'"><span>画像を保存</span></a>').join("");
  showView("recipeDetailView");
}
function renderDetailStages(r){
  const base=recipeYield(r),target=Number($("detailYieldQuantity").value);
  const valid=Number.isFinite(target)&&target>0;
  const ratio=valid?target*unitFactor($("detailYieldUnit").value)/(base.quantity*unitFactor(base.unit)):1;
  $("detailYieldNote").textContent="基準："+base.quantity+base.unit+(valid?" ／ "+formatNumber(ratio)+"倍":" ／ 0より大きい必要量を入力してください（基準量を表示中）");
  const stages=r.stages||[];
  $("detailStages").innerHTML=stages.map(stage=>{
    const nameHtml=stage.groupName?`<div class="detail-stage-name">${esc(stage.groupName)}</div>`:"";
    const ingHtml=stage.ingredients.length?`<h4>材料</h4><ul class="plain-list">${stage.ingredients.map(i=>{
      const amount=ingredientAmount(i,ratio);
      return `<li>${esc(i.name)}${amount?`　${esc(amount)}`:""}</li>`;
    }).join("")}</ul>`:"";
    const steps=(stage.instruction||"").split("\n").map(s=>s.trim()).filter(Boolean);
    const stepsHtml=steps.length?`<h4>作り方</h4><ol class="steps-list">${steps.map(s=>`<li>${esc(s)}</li>`).join("")}</ol>`:"";
    const imagesHtml=stage.images?.length?`<div class="attachment-gallery detail-stage-images">${stage.images.map((src,i)=>`<img src="${esc(src)}" alt="${esc(stage.groupName||"工程")}の仕込み画像${i+1}">`).join("")}</div>`:"";
    return `<div class="detail-stage">${nameHtml}${ingHtml}${stepsHtml}${imagesHtml}</div>`;
  }).join("");
}
function recipeExportData(){
  const recipe=findRecipe(currentRecipeId);
  if(!recipe)return null;
  const base=recipeYield(recipe);
  const quantity=Number($("detailYieldQuantity").value),unit=$("detailYieldUnit").value||base.unit;
  if(!Number.isFinite(quantity)||quantity<=0){
    $("recipeExportStatus").textContent="共有・PDF保存の前に、0より大きい必要量を入力してください。";
    $("detailYieldQuantity").focus();return null;
  }
  $("recipeExportStatus").textContent="";
  return {recipe,base,quantity,unit,ratio:quantity*unitFactor(unit)/(base.quantity*unitFactor(base.unit))};
}
function recipeShareText(data){
  const {recipe:r,base,quantity,unit,ratio}=data;
  const lines=[r.name,"分量："+formatNumber(quantity)+unit];
  if(ratio!==1)lines.push("元の基準量："+base.quantity+base.unit);
  if(r.cookTime)lines.push("調理時間："+r.cookTime);
  for(const [index,stage] of (r.stages||[]).entries()){
    lines.push("",stage.groupName||"工程 "+(index+1));
    if(stage.ingredients?.length)lines.push("【材料】",...stage.ingredients.map(i=>[i.name,ingredientAmount(i,ratio)].filter(Boolean).join("　")));
    if(stage.instruction)lines.push("【作り方】",stage.instruction);
  }
  if(r.memo)lines.push("","【メモ】",r.memo);
  if(r.sourceText)lines.push("","【取り込んだレシピ】",r.sourceText);
  if(r.attachments?.length||r.stages?.some(s=>s.images?.length))lines.push("","※ 添付画像は文章の共有には含まれません。PDF保存で確認できます。");
  return lines.join("\n");
}
async function shareCurrentRecipe(){
  const data=recipeExportData();if(!data)return;
  const text=recipeShareText(data);
  $("recipeExportStatus").textContent="";
  if(navigator.share){
    try{await navigator.share({title:data.recipe.name,text});return;}
    catch(error){if(error.name==="AbortError")return;}
  }
  showRecipeCopy(text);
}
function showRecipeCopy(text){
  let dialog=$("recipeCopyDialog");
  if(!dialog){
    dialog=document.createElement("dialog");dialog.id="recipeCopyDialog";
    dialog.setAttribute("aria-labelledby","recipeCopyTitle");
    dialog.innerHTML='<h2 id="recipeCopyTitle">レシピを共有</h2><p class="task-note">文章をコピーし、LINEやメールに貼り付けて送れます。</p><label for="recipeCopyText">共有する文章</label><textarea id="recipeCopyText" rows="12" readonly></textarea><p id="recipeCopyStatus" class="task-status" role="status"></p><div class="form-actions"><button id="copyRecipeTextButton" type="button" class="primary-button">文章をコピー</button><button id="closeRecipeCopyButton" type="button" class="secondary-button">閉じる</button></div>';
    document.body.append(dialog);
    $("closeRecipeCopyButton").onclick=()=>dialog.close();
    $("copyRecipeTextButton").onclick=async()=>{
      try{await navigator.clipboard.writeText($("recipeCopyText").value);$("recipeCopyStatus").textContent="コピーしました。LINEやメールに貼り付けてください。";}
      catch{$("recipeCopyText").focus();$("recipeCopyText").select();$("recipeCopyStatus").textContent="文章を長押し、または Ctrl+C でコピーしてください。";}
    };
  }
  $("recipeCopyText").value=text;$("recipeCopyStatus").textContent="";dialog.showModal();
}
function previewRecipePdf(){
  const data=recipeExportData();if(!data)return;
  const {recipe:r,base,quantity,unit,ratio}=data;
  const photo=src=>/^data:image\/(png|jpeg|jpg|webp|gif);base64,/i.test(src||"")?'<img src="'+esc(src)+'" alt="レシピの画像">':"";
  let html='<h1>'+esc(r.name)+'</h1><p>分量：'+esc(formatNumber(quantity)+unit)+'</p>';
  if(ratio!==1)html+='<p>元の基準量：'+esc(base.quantity+base.unit)+'</p>';
  if(r.cookTime)html+='<p>調理時間：'+esc(r.cookTime)+'</p>';
  html+=photo(r.photo);
  for(const [index,stage] of (r.stages||[]).entries()){
    html+='<section><h2>'+esc(stage.groupName||"工程 "+(index+1))+'</h2>';
    if(stage.ingredients?.length)html+='<h3>材料</h3><ul>'+stage.ingredients.map(i=>'<li>'+esc([i.name,ingredientAmount(i,ratio)].filter(Boolean).join("　"))+'</li>').join("")+'</ul>';
    if(stage.instruction)html+='<h3>作り方</h3><p class="print-text">'+esc(stage.instruction)+'</p>';
    if(stage.images?.length)html+=stage.images.map(photo).join("");
    html+='</section>';
  }
  if(r.memo)html+='<section><h2>メモ</h2><p class="print-text">'+esc(r.memo)+'</p></section>';
  if(r.sourceText)html+='<section><h2>取り込んだレシピ</h2><p class="print-text">'+esc(r.sourceText)+'</p></section>';
  if(r.attachments?.length)html+='<section><h2>添付レシピ</h2>'+r.attachments.map(photo).join("")+'</section>';
  $("recipePrintContent").innerHTML=html;
  $("printRecipeStatus").textContent="";
  backTargets.recipePrintView="recipeDetailView";
  showView("recipePrintView");$("headerTitle").textContent="PDF保存";
}
async function printRecipePdf(){
  const button=$("printRecipeButton");button.disabled=true;
  try{
    await Promise.all([...$("recipePrintContent").querySelectorAll("img")].map(img=>img.decode()));
    window.print();
  }catch{$("printRecipeStatus").textContent="印刷画面を開けませんでした。画像の読み込みを確認し、もう一度お試しください。";}
  finally{button.disabled=false;}
}
function deleteCurrentRecipe(){
  const r=findRecipe(currentRecipeId);
  if(!r)return;
  if(!confirm(`「${r.name}」を削除しますか？`))return;
  state.recipes=state.recipes.filter(x=>x.id!==currentRecipeId);
  save();
  renderCategoryList();
  showView("categoryView");
}

/* ---------- category edit ---------- */
function renderCategoryEditList(){
  $("categoryEditList").innerHTML=state.categories.map((c,i)=>`
    <li data-id="${c.id}">
      <span class="category-edit-name">${esc(c.name)}</span>
      <button class="secondary-button small-button up" type="button" ${i===0?"disabled":""}>↑</button>
      <button class="secondary-button small-button down" type="button" ${i===state.categories.length-1?"disabled":""}>↓</button>
      <button class="secondary-button small-button rename" type="button">名前変更</button>
      <button class="danger-outline-button small-button del" type="button">削除</button>
    </li>`).join("");
  $("categoryEditList").querySelectorAll("li").forEach((li,i)=>{
    const cat=state.categories[i];
    li.querySelector(".up").onclick=()=>moveCategory(i,-1);
    li.querySelector(".down").onclick=()=>moveCategory(i,1);
    li.querySelector(".rename").onclick=()=>renameCategory(cat);
    li.querySelector(".del").onclick=()=>deleteCategory(cat);
  });
}
function moveCategory(i,dir){
  const j=i+dir;
  if(j<0||j>=state.categories.length)return;
  [state.categories[i],state.categories[j]]=[state.categories[j],state.categories[i]];
  save();
  renderCategoryEditList();
}
function renameCategory(cat){
  const name=prompt("新しいカテゴリ名を入力してください。",cat.name)?.trim();
  if(!name||name===cat.name)return;
  if(state.categories.some(c=>c.id!==cat.id&&c.name===name)){alert("同じ名前のカテゴリがすでにあります。");return;}
  cat.name=name;
  save();
  renderCategoryEditList();
}
function deleteCategory(cat){
  const count=recipesInCategory(cat.id).length;
  const msg=count?`「${cat.name}」を削除しますか？\nこのカテゴリの中のレシピ${count}件も一緒に削除されます。`:`「${cat.name}」を削除しますか？`;
  if(!confirm(msg))return;
  state.categories=state.categories.filter(c=>c.id!==cat.id);
  state.recipes=state.recipes.filter(r=>r.categoryId!==cat.id);
  save();
  renderCategoryEditList();
}
function addCategory(){
  const input=$("newCategoryName");
  const name=input.value.trim();
  if(!name)return;
  if(state.categories.some(c=>c.name===name)){alert("同じ名前のカテゴリがすでにあります。");return;}
  state.categories.push({id:id(),name});
  if(!save())return;
  input.value="";
  renderCategoryEditList();
}

function addRecipeCategory(){
  const name=prompt("新しいカテゴリー名を入力してください（20文字以内）。")?.trim();
  if(!name)return;
  if(name.length>20){alert("カテゴリー名は20文字以内で入力してください。");return;}
  if(state.categories.some(c=>c.name===name)){alert("同じ名前のカテゴリーがすでにあります。");return;}
  const category={id:id(),name};
  state.categories.push(category);
  if(!save())return;
  $("recipeCategory").add(new Option(category.name,category.id));
  $("recipeCategory").value=category.id;
  $("recipeCategory").focus();
}

/* ---------- data management ---------- */
function exportBackup(){
  const blob=new Blob([JSON.stringify(state,null,2)],{type:"application/json"});
  const a=document.createElement("a");
  a.href=URL.createObjectURL(blob);
  a.download=`飲食店レシピ帳_バックアップ_${new Date().toISOString().slice(0,10)}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
}
function importBackup(e){
  const file=e.target.files[0];
  if(!file)return;
  const reader=new FileReader();
  reader.onload=async()=>{
    try{
      const x=JSON.parse(reader.result);
      if(!Array.isArray(x.categories)||!Array.isArray(x.recipes))throw 0;
      if(!confirm("現在のデータを、バックアップファイルの内容に置き換えますか？\nこの操作は取り消せません。"))return;
      migrateRecipes(x);
      await putImages(recipeImages(x));
      state=x;
      if(!save())return;
      currentCategoryId=null;
      renderCategoryList();
      updateShopSettingsSummary();
      refreshPreparationUnits();
      alert("復元しました。");
    }catch{
      alert("正しいバックアップファイルではありません。");
    }
    e.target.value="";
  };
  reader.readAsText(file);
}

/* ---------- stages (材料＋作り方) ---------- */
function renderStages(){
  $("stagesContainer").innerHTML=formStages.map((stage,si)=>`
    <div class="stage-block" data-si="${si}">
      <div class="stage-header">
        <input type="text" class="stage-name-input" placeholder="工程名（任意、例：A）" value="${esc(stage.groupName)}">
        ${formStages.length>1?`<button type="button" class="secondary-button small-button remove-stage">工程を削除</button>`:""}
      </div>
      <label>材料</label>
      <div class="ingredient-rows" data-si="${si}"></div>
      <button type="button" class="secondary-button small-button add-ingredient-row">＋ 材料を追加</button>
      <label>この工程でやること</label>
      <textarea class="stage-instruction-input" rows="3" placeholder="例：鍋にすべての材料を入れて弱火で3分煮詰める">${esc(stage.instruction)}</textarea>
      <label>仕込み画像（任意・複数選択可）</label>
      <div class="stage-images-preview attachment-gallery" data-si="${si}"></div>
      <input type="file" class="stage-images-input" accept="image/*" multiple aria-label="仕込み画像を追加" ${imageJobs?"disabled":""}>
    </div>`).join("");

  formStages.forEach((stage,si)=>{
    const block=$("stagesContainer").querySelector(`.stage-block[data-si="${si}"]`);
    block.querySelector(".stage-name-input").oninput=e=>{stage.groupName=e.target.value;};
    const removeBtn=block.querySelector(".remove-stage");
    if(removeBtn)removeBtn.onclick=()=>removeStage(si);
    block.querySelector(".stage-instruction-input").oninput=e=>{stage.instruction=e.target.value;};
    block.querySelector(".add-ingredient-row").onclick=()=>addIngredientRowToStage(si);
    block.querySelector(".stage-images-input").onchange=e=>onStageImagesChange(stage,e);
    renderStageIngredientRows(si);
    renderStageImages(stage,si);
  });
}
function renderStageImages(stage,si){
  const container=$("stagesContainer").querySelector(`.stage-images-preview[data-si="${si}"]`);
  if(!container)return;
  container.innerHTML=stage.images.map((src,i)=>'<div><img src="'+esc(src)+'" alt="仕込み画像 '+(i+1)+'"><button type="button" class="secondary-button" data-remove="'+i+'">画像 '+(i+1)+' を削除</button></div>').join("");
  container.querySelectorAll("button").forEach(b=>b.onclick=()=>{stage.images.splice(Number(b.dataset.remove),1);renderStageImages(stage,si);});
}
async function onStageImagesChange(stage,e){
  const files=[...e.target.files],session=formSession;
  if(!files.length)return;
  imageJobs++;setImageBusy();
  try{
    for(const file of files){const data=await compressImage(file,1800,0.88);if(session!==formSession)return;stage.images.push(data);renderStageImages(stage,formStages.indexOf(stage));}
  }catch{if(session===formSession)$("recipeFormError").textContent="一部の画像を読み込めませんでした。追加済みの画像を確認し、JPEG・PNGなどで追加し直してください。";}
  finally{if(session===formSession){imageJobs--;setImageBusy();e.target.value="";}}
}
function renderStageIngredientRows(si){
  const {names}=ingredientHistory(),stage=formStages[si];
  const container=$("stagesContainer").querySelector('.ingredient-rows[data-si="'+si+'"]');
  stage.ingredients=stage.ingredients.map(parseIngredient);
  container.innerHTML=stage.ingredients.map((ing,ii)=>'<div class="ingredient-row" data-ii="'+ii+'"><div class="autocomplete-wrap"><input type="text" class="name-input" aria-label="材料名" placeholder="材料名" value="'+esc(ing.name)+'" autocomplete="off"><ul class="suggest-list hidden"></ul></div><input class="quantity-input" type="number" inputmode="decimal" min="0" step="any" aria-label="数量" placeholder="数量" value="'+esc(ing.quantity)+'"><select class="unit-input" aria-label="単位">'+unitOptions(UNITS,ing.unit)+'</select><button type="button" class="remove-row" aria-label="材料を削除">×</button>'+(ing.legacyAmount?'<label class="legacy-amount">元の分量（自由入力）<input class="legacy-input" type="text" value="'+esc(ing.legacyAmount)+'"></label>':'')+'</div>').join("");
  container.querySelectorAll(".ingredient-row").forEach(row=>{
    const ing=stage.ingredients[Number(row.dataset.ii)];
    setupAutocomplete(row.querySelector(".name-input"),row.querySelector(".suggest-list"),names,v=>ing.name=v);
    row.querySelector(".quantity-input").oninput=e=>{ing.quantity=e.target.value;ing.legacyAmount="";const old=row.querySelector(".legacy-amount");if(old)old.remove();};
    row.querySelector(".unit-input").onchange=e=>{ing.unit=e.target.value;ing.legacyAmount="";const old=row.querySelector(".legacy-amount");if(old)old.remove();};
    const legacy=row.querySelector(".legacy-input");if(legacy)legacy.oninput=e=>ing.legacyAmount=e.target.value;
    row.querySelector(".remove-row").onclick=()=>{stage.ingredients.splice(Number(row.dataset.ii),1);renderStageIngredientRows(si);};
  });
}
function addIngredientRowToStage(si){
  formStages[si].ingredients.push({name:"",amount:""});
  renderStageIngredientRows(si);
  const container=$("stagesContainer").querySelector(`.ingredient-rows[data-si="${si}"]`);
  const rows=container.querySelectorAll(".name-input");
  rows[rows.length-1]?.focus();
}
function addStage(){
  formStages.push({groupName:"",ingredients:[{name:"",amount:""}],instruction:"",images:[]});
  renderStages();
}
function removeStage(si){
  if(formStages.length<=1)return;
  formStages.splice(si,1);
  renderStages();
}

/* ---------- recipe form ---------- */
function openRecipeForm(recipe){
  $("recipeForm").reset();
  $("recipeFormError").textContent="";
  $("recipeId").value=recipe?.id||"";
  $("recipeFormTitle").textContent=recipe?"レシピを編集":"レシピを追加";
  $("recipeName").value=recipe?.name||"";
  $("recipeCategory").innerHTML='<option value="">未分類</option>'+state.categories.map(c=>`<option value="${esc(c.id)}">${esc(c.name)}</option>`).join("");
  $("recipeCategory").value=recipe?recipe.categoryId||"":currentCategoryId||"";
  const base=recipeYield(recipe||{});
  $("recipeYieldQuantity").value=base.quantity;
  const custom=!YIELD_UNITS.includes(base.unit);
  $("recipeYieldUnit").innerHTML=unitOptions([...YIELD_UNITS,"その他"],custom?"その他":base.unit);
  $("recipeYieldCustom").value=custom?base.unit:"";
  syncYieldCustom();
  renderChecks("recipeMonths",["all",...MONTHS],recipe?.months||[],v=>v==="all"?"通年":v+"月");
  renderChecks("recipeSeasons",["all",...SEASONS],recipe?.seasons||[],v=>v==="all"?"通年":v);
  $("recipeSourceText").value=recipe?.sourceText||"";
  formAttachments=[...(recipe?.attachments||[])];
  formSession++;imageJobs=0;setImageBusy();renderAttachments();
  formStages=recipe?.stages?.length?recipe.stages.map(s=>({groupName:s.groupName||"",ingredients:(s.ingredients||[]).map(i=>({...i})),instruction:s.instruction||"",images:[...(s.images||[])]})):[{groupName:"",ingredients:[{name:"",amount:""}],instruction:"",images:[]}];
  renderStages();
  $("recipeCookedDate").value=recipe?.cookedDate||"";
  $("recipeCookTime").value=recipe?.cookTime||"";
  $("recipeMemo").value=recipe?.memo||"";
  formPhoto=recipe?.photo||"";
  renderPhotoPreview();
  openModal("recipeForm");
  $("recipeName").focus();
}

function renderPhotoPreview(){
  const img=$("recipePhotoPreview");
  const removeBtn=$("removePhotoButton");
  if(formPhoto){img.src=formPhoto;img.classList.remove("hidden");removeBtn.classList.remove("hidden");}
  else{img.classList.add("hidden");removeBtn.classList.add("hidden");}
}
function onPhotoChange(e){
  const file=e.target.files[0];if(!file)return;
  const session=formSession;
  imageJobs++;setImageBusy();
  compressImage(file).then(data=>{if(session===formSession){formPhoto=data;renderPhotoPreview();}}).catch(()=>{if(session===formSession)$("recipeFormError").textContent="写真を読み込めませんでした。JPEG・PNGなどの画像を選び直してください。";}).finally(()=>{if(session===formSession){imageJobs--;setImageBusy();}});
}
function compressImage(file,maxWidth=1000,quality=0.75){
  return new Promise((resolve,reject)=>{
    const reader=new FileReader();
    reader.onload=()=>{
      const img=new Image();
      img.onload=()=>{
        let w=img.width,h=img.height;
        if(w>maxWidth){h=Math.round(h*maxWidth/w);w=maxWidth;}
        const canvas=document.createElement("canvas");
        canvas.width=w;canvas.height=h;
        canvas.getContext("2d").drawImage(img,0,0,w,h);
        resolve(canvas.toDataURL("image/jpeg",quality));
      };
      img.onerror=reject;
      img.src=reader.result;
    };
    reader.onerror=reject;
    reader.readAsDataURL(file);
  });
}
async function saveRecipeForm(e){
  e.preventDefault();if(imageJobs)return;
  const existingId=$("recipeId").value;
  if(!existingId&&!canAddRecipe()){closeModal("recipeForm");openPurchaseModal();return;}
  const name=$("recipeName").value.trim();
  if(!name){$("recipeFormError").textContent="料理名を入力してください。";return;}
  const quantity=Number($("recipeYieldQuantity").value);
  if(!Number.isFinite(quantity)||quantity<=0){$("recipeFormError").textContent="基準量には0より大きい数を入力してください。";return;}
  const unit=$("recipeYieldUnit").value==="その他"?$("recipeYieldCustom").value.trim():$("recipeYieldUnit").value;
  if(!unit){$("recipeFormError").textContent="単位を入力してください。";$("recipeYieldCustom").focus();return;}
  const categoryId=$("recipeCategory").value;
  const stages=formStages.map(s=>({groupName:s.groupName.trim(),ingredients:s.ingredients.map(i=>({...parseIngredient(i),name:i.name.trim(),amount:ingredientAmount(i,1)})).filter(i=>i.name),instruction:s.instruction.trim(),images:[...s.images]})).filter(s=>s.groupName||s.ingredients.length||s.instruction||s.images.length);
  const data={name,categoryId,photo:formPhoto,attachments:[...formAttachments],sourceText:$("recipeSourceText").value,months:checkedValues("recipeMonths"),seasons:checkedValues("recipeSeasons"),yield:{quantity,unit},stages,cookedDate:$("recipeCookedDate").value,cookTime:$("recipeCookTime").value.trim(),memo:$("recipeMemo").value.trim()};
  const session=formSession;
  imageJobs++;setImageBusy();
  await putImages([data.photo,...data.attachments,...data.stages.flatMap(s=>s.images)]);
  if(session!==formSession)return;
  imageJobs--;setImageBusy();
  const next=JSON.parse(JSON.stringify(state));
  if(existingId){const r=next.recipes.find(r=>r.id===existingId);Object.assign(r,data);delete r.rating;}
  else next.recipes.push({id:id(),...data});
  try{localStorage.setItem(KEY,serializeState(next));}catch{
    $("recipeFormError").textContent="保存できませんでした。入力内容は残っています。画像を減らすか、端末の空き容量を確認してください。";return;
  }
  state=next;closeModal("recipeForm");
  currentCategoryId=categoryId||null;selectedMonths=[];selectedSeasons=[];$("recipeSearch").value="";renderFilters();renderCategoryList();
  if(existingId)openRecipeDetail(existingId);else showView("categoryView");
}

/* ---------- modal ---------- */
function openModal(name){
  modalReturnFocus=document.activeElement;
  $(name+"Modal").classList.remove("hidden");
  $(name+"Modal").setAttribute("aria-hidden","false");
  document.body.classList.add("modal-open");
}
function closeModal(name){
  $(name+"Modal").classList.add("hidden");
  $(name+"Modal").setAttribute("aria-hidden","true");
  document.body.classList.remove("modal-open");
  formSession++;imageJobs=0;
  modalReturnFocus?.focus();
}


/* Quantity fields preserve old free-form amounts when they cannot be safely parsed. */
function unitOptions(units,selected=""){
  return [...new Set([...orderedShopUnits(units),selected])].map(u=>'<option value="'+esc(u)+'"'+(u===selected?' selected':'')+'>'+esc(u||"—")+'</option>').join("");
}

function shopIndustries(){
  return Array.isArray(state.shopSettings?.industries)?state.shopSettings.industries.filter(key=>Object.hasOwn(SHOP_PRESETS,key)):[];
}
function orderedShopUnits(units,industries=shopIndustries()){
  const preferred=industries.flatMap(key=>SHOP_PRESETS[key]?.units||[]).filter(unit=>units.includes(unit));
  return [...new Set([...(units.includes("")?[""]:[]),...preferred,...units])];
}
function updateShopSettingsSummary(){
  const names=shopIndustries().map(key=>SHOP_PRESETS[key].name);
  $("shopSettingsSummary").textContent=names.length?"選択中："+names.join("・"):"業種は未設定です。お店に合わせたカテゴリー候補を選べます。";
}
function refreshPreparationUnits(){
  $("preparationRows").querySelectorAll(".unit-input").forEach(select=>{
    const selected=select.value;
    select.innerHTML=unitOptions([...new Set([...UNITS,...YIELD_UNITS])],selected);
  });
}
function openShopSettings(returnView){
  shopSettingsReturnView=returnView;
  backTargets.shopSettingsView=returnView;
  const selected=shopIndustries();
  $("shopIndustryOptions").innerHTML=Object.entries(SHOP_PRESETS).map(([key,preset])=>'<label><input type="checkbox" value="'+key+'"'+(selected.includes(key)?' checked':'')+'><span>'+esc(preset.name)+'</span></label>').join("");
  $("shopIndustryStep").classList.remove("hidden");
  $("shopCategoryStep").classList.add("hidden");
  $("shopSettingsStatus").textContent="";
  $("skipShopSettings").textContent=returnView==="homeView"?"あとで設定する":"変更せず戻る";
  $("shopSettingsSave").textContent=returnView==="homeView"?"この内容で始める":"変更を保存";
  showView("shopSettingsView");
}
function leaveShopSettings(){
  if(!state.shopSettings?.completed){state.shopSettings={completed:true,industries:[]};if(!save())return;}
  updateShopSettingsSummary();showView(shopSettingsReturnView);
}
function previewShopCategories(){
  const industries=checkedValues("shopIndustryOptions");
  if(!industries.length){$("shopSettingsStatus").textContent="業種を選んでください。候補がない場合は「その他・自分で設定」を選べます。";return;}
  const categories=[...new Set(industries.flatMap(key=>SHOP_PRESETS[key].categories))];
  $("shopCategoryOptions").innerHTML=categories.length?categories.map(name=>{
    const existing=state.categories.find(category=>category.name===name);
    const protectedCategory=existing&&!isUnusedPresetCategory(existing);
    return '<label><input type="checkbox" value="'+esc(name)+'" checked'+(protectedCategory?' disabled':'')+'><span>'+esc(name)+(existing?'（登録済み）':'')+'</span></label>';
  }).join(""):'<p class="task-note">カテゴリーは追加しません。設定の「カテゴリー管理」から自由に作成できます。</p>';
  const units=orderedShopUnits(UNITS,industries).filter(Boolean).slice(0,4);
  $("shopUnitPreview").textContent="よく使う単位："+units.join("、")+"…";
  $("shopIndustryStep").classList.add("hidden");
  $("shopCategoryStep").classList.remove("hidden");
  $("shopSettingsStatus").textContent="";
  $("shopCategoryOptions").onchange=updateCategoryCleanupPreview;
  updateCategoryCleanupPreview();
  $("shopSettingsPrevious").focus();
}
function isUnusedPresetCategory(category){
  const legacy={sauce:"ソースレシピ",tare:"タレレシピ",dressing:"ドレッシングレシピ",spice:"スパイスレシピ",side:"総菜レシピ",meat:"肉料理レシピ",fish:"魚料理レシピ"};
  const automatic=category.presetName===category.name||(Object.hasOwn(legacy,category.id)&&legacy[category.id]===category.name);
  return automatic&&!state.recipes.some(recipe=>recipe.categoryId===category.id);
}
function unusedCategoriesToRemove(){
  const selected=new Set(checkedValues("shopCategoryOptions"));
  return state.categories.filter(category=>isUnusedPresetCategory(category)&&!selected.has(category.name));
}
function updateCategoryCleanupPreview(){
  const removed=unusedCategoriesToRemove();
  $("shopCategoryCleanup").textContent=removed.length?"保存すると、未使用の初期カテゴリーを整理します："+removed.map(category=>category.name).join("、"):"整理する未使用の初期カテゴリーはありません。";
}
function saveShopSettings(e){
  e.preventDefault();
  if($("shopCategoryStep").classList.contains("hidden")){previewShopCategories();return;}
  const industries=checkedValues("shopIndustryOptions");
  const removed=new Set(unusedCategoriesToRemove().map(category=>category.id));
  state.categories=state.categories.filter(category=>!removed.has(category.id));
  for(const name of checkedValues("shopCategoryOptions")){
    if(!state.categories.some(category=>category.name===name))state.categories.push({id:id(),name,presetName:name});
  }
  state.shopSettings={completed:true,industries};
  if(!save()){$("shopSettingsStatus").textContent="保存できませんでした。選択内容を確認してもう一度保存してください。";return;}
  if(removed.has(currentCategoryId))currentCategoryId=null;
  renderCategoryList();
  updateShopSettingsSummary();
  refreshPreparationUnits();
  showView(shopSettingsReturnView);
}
function parseIngredient(i){
  if(i.quantity!==undefined)return {...i,quantity:String(i.quantity),unit:i.unit||"",legacyAmount:i.legacyAmount||""};
  const amount=String(i.amount||"").trim();
  const match=amount.match(/^(\d+(?:\.\d+)?|\.\d+)\s*([^\d]*)$/);
  if(match)return {...i,quantity:match[1],unit:match[2].trim(),legacyAmount:""};
  const spoon=amount.match(/^(大さじ|小さじ)\s*(\d+(?:\.\d+)?)$/);
  if(spoon)return {...i,quantity:spoon[2],unit:spoon[1],legacyAmount:""};
  if(["少々","適量"].includes(amount))return {...i,quantity:"",unit:amount,legacyAmount:""};
  return {...i,quantity:"",unit:"",legacyAmount:amount};
}
function ingredientAmount(item,ratio=1){
  const i=parseIngredient(item);
  if(i.legacyAmount)return i.legacyAmount+(ratio!==1?"（換算対象外）":"");
  const q=i.quantity===""?"":formatNumber(Number(i.quantity)*ratio);
  return ["大さじ","小さじ"].includes(i.unit)?i.unit+q:q+i.unit;
}
function recipeYield(r){
  if(r.yield&&Number(r.yield.quantity)>0&&Number.isFinite(Number(r.yield.quantity)))return {quantity:Number(r.yield.quantity),unit:r.yield.unit||"人前"};
  const old=String(r.servingBase||"1人前").match(/^(\d+(?:\.\d+)?)(.*)$/);
  return {quantity:old?Number(old[1]):1,unit:old?old[2]:"人前"};
}
function unitFactor(unit){return {kg:1000,g:1,L:1000,ml:1}[unit]||1;}
function compatibleUnits(unit){return ["g","kg"].includes(unit)?["g","kg"]:["ml","L"].includes(unit)?["ml","L"]:[unit];}
function renderChecks(id,values,selected,label){
  const normalized=selected.map(String).includes("all")?["all"]:selected.map(String);
  $(id).innerHTML=values.map(v=>'<label><input type="checkbox" value="'+esc(v)+'"'+(normalized.includes(v)?' checked':'')+'><span>'+label(v)+'</span></label>').join("");
  $(id).onchange=e=>{
    if(e.target.type!=="checkbox"||!e.target.checked)return;
    $(id).querySelectorAll("input").forEach(input=>{if(input!==e.target&&(e.target.value==="all"||input.value==="all"))input.checked=false;});
  };
}
function checkedValues(id){return [...$(id).querySelectorAll("input:checked")].map(i=>i.value);}
function renderFilters(){
  [["monthFilters",MONTHS,selectedMonths,v=>v+"月"],["seasonFilters",SEASONS,selectedSeasons,v=>v]].forEach(([id,values,selected,label])=>{
    $(id).innerHTML=["all",...values,"unset"].map(v=>'<label><input type="checkbox" value="'+v+'"'+(selected.includes(v)?' checked':'')+'><span>'+(v==="all"?"通年":v==="unset"?"未設定":label(v))+'</span></label>').join("");
  });
  updateFilterSummaries();
}
function renderAttachments(){
  $("recipeAttachmentsPreview").innerHTML=formAttachments.map((src,i)=>'<div><img src="'+esc(src)+'" alt="添付画像 '+(i+1)+'"><button type="button" class="secondary-button" data-remove="'+i+'">画像 '+(i+1)+' を削除</button></div>').join("");
  $("recipeAttachmentsPreview").querySelectorAll("button").forEach(b=>b.onclick=()=>{formAttachments.splice(Number(b.dataset.remove),1);renderAttachments();});
}
function setImageBusy(){
  $("recipeForm").querySelector('[type="submit"]').disabled=imageJobs>0;
  $("recipeAttachmentsInput").disabled=imageJobs>0;
  $("recipePhotoInput").disabled=imageJobs>0;
  $("removePhotoButton").disabled=imageJobs>0;
  $("stagesContainer").querySelectorAll(".stage-images-input").forEach(i=>i.disabled=imageJobs>0);
  $("attachmentStatus").textContent=imageJobs?"画像を読み込んでいます…":"画像と文章はそのまま保存されます。自動文字起こしは行いません。";
}
async function onAttachmentsChange(e){
  const files=[...e.target.files],session=formSession;
  if(!files.length)return;
  imageJobs++;setImageBusy();
  try{
    for(const file of files){const data=await compressImage(file,1800,0.88);if(session!==formSession)return;formAttachments.push(data);renderAttachments();}
  }catch{if(session===formSession)$("recipeFormError").textContent="一部の画像を読み込めませんでした。添付済みの画像を確認し、JPEG・PNGなどで追加し直してください。";}
  finally{if(session===formSession){imageJobs--;setImageBusy();e.target.value="";}}
}
function prepDirty(){
  preparationDirty=true;
  clearTimeout(prepFeedbackTimer);$("preparationSaveButton").textContent="保存";$("preparationStatus").textContent="未保存の変更があります。";
}

function loadPreparationMemo(){
  restorePreparation(null);
  try{
    const current=localStorage.getItem(PREPARATION_KEY);
    if(current!==null){restorePreparation(current);return;}
    const old=localStorage.getItem(LEGACY_PREPARATION_KEY);
    if(old===null)return;
    const record=JSON.parse(old);
    let migrated;
    if(typeof record.text==="string")migrated={text:record.text,rows:[]};
    else if(Array.isArray(record.rows))migrated={text:"",rows:record.rows};
    else throw new Error("Unknown legacy memo");
    restorePreparation(JSON.stringify({kind:"preparation",version:2,...migrated}));
    // Remove legacy data only after the migrated record is safely stored.
    localStorage.setItem(PREPARATION_KEY,JSON.stringify(readPreparation()));
    localStorage.removeItem(LEGACY_PREPARATION_KEY);
  }catch{
    $("preparationStatus").textContent="保存データの読み込み・移行を完了できませんでした。元のデータは削除していません。入力内容を確認して保存してください。";
  }
}
function addPreparationRow(item={}){
  const row=document.createElement("div");
  row.className="ingredient-row";
  row.innerHTML='<input type="text" class="name-input" aria-label="仕込み名" placeholder="仕込み名"><input class="quantity-input" type="number" inputmode="decimal" min="0" step="any" aria-label="数量" placeholder="数量"><select class="unit-input" aria-label="単位"></select><button type="button" class="remove-row" aria-label="仕込みを削除">×</button>';
  row.querySelector(".name-input").value=String(item.name??"");
  row.querySelector(".quantity-input").value=String(item.quantity??"");
  row.querySelector(".unit-input").innerHTML=unitOptions([...new Set([...UNITS,...YIELD_UNITS])],String(item.unit??""));
  row.oninput=prepDirty;
  row.querySelector("button").onclick=()=>{
    const next=row.nextElementSibling||row.previousElementSibling;
    row.remove();
    if(!$("preparationRows").children.length)addPreparationRow();
    (next||$("preparationRows").firstElementChild).querySelector("input").focus();
    prepDirty();
  };
  $("preparationRows").append(row);
}
function readPreparation(){
  return {kind:"preparation",version:2,text:$("preparationText").value,rows:[...$("preparationRows").children].map(row=>({
    name:row.querySelector(".name-input").value,
    quantity:row.querySelector(".quantity-input").value,
    unit:row.querySelector(".unit-input").value
  })).filter(row=>row.name||row.quantity||row.unit)};
}
function restorePreparation(raw){
  let record={text:raw||"",rows:[]};
  try{
    const parsed=JSON.parse(raw);
    if(parsed?.kind==="preparation"&&parsed.version===2&&typeof parsed.text==="string"&&Array.isArray(parsed.rows))record=parsed;
  }catch{/* Earlier versions stored plain text; preserve it unchanged. */}
  $("preparationText").value=record.text;
  $("preparationRows").replaceChildren();
  record.rows.forEach(row=>addPreparationRow(row||{}));
  if(!record.rows.length)addPreparationRow();
}
function deletePreparationMemo(){
  clearTimeout(prepFeedbackTimer);
  try{
    // Remove legacy first so a failed deletion cannot resurrect an older memo next time.
    localStorage.removeItem(LEGACY_PREPARATION_KEY);
    localStorage.removeItem(PREPARATION_KEY);
    restorePreparation(null);
    preparationDirty=false;
    $("preparationSaveButton").textContent="保存";
    $("preparationStatus").textContent="仕込み内容を削除しました。";
  }catch{
    $("preparationStatus").textContent="削除できませんでした。入力内容は残っています。もう一度お試しください。";
  }
  $("deletePreparationDialog").close();
}
function syncYieldCustom(){
  const custom=$("recipeYieldUnit").value==="その他";
  $("recipeYieldCustomWrap").classList.toggle("hidden",!custom);
  $("recipeYieldCustom").required=custom;
  $("recipeYieldCustom").disabled=!custom;
}
function matchesTags(values,selected,domain){
  if(!selected.length)return true;
  const tags=(values||[]).map(String);
  const allYear=tags.includes("all")||domain.every(v=>tags.includes(v));
  return selected.some(v=>v==="unset"?tags.length===0:v==="all"?allYear:allYear||tags.includes(v));
}
function filterLabel(selected,domain,kind){
  if(!selected.length)return kind;
  if(selected.includes("all"))return "通年";
  const ordered=[...domain,"unset"].filter(v=>selected.includes(v));
  if(kind==="月"&&ordered.length>2&&!ordered.includes("unset"))return ordered.length+"か月選択";
  return ordered.map(v=>v==="unset"?"未設定":kind==="月"?v+"月":v).join("・");
}
function updateFilterSummaries(){
  $("monthSummary").textContent=(selectedMonths.length?filterLabel(selectedMonths,MONTHS,"月"):"月で検索")+" ▾";
  $("seasonSummary").textContent=(selectedSeasons.length?filterLabel(selectedSeasons,SEASONS,"季節"):"季節で検索")+" ▾";
  $("monthSummary").classList.toggle("filter-placeholder",!selectedMonths.length);
  $("seasonSummary").classList.toggle("filter-placeholder",!selectedSeasons.length);
}
function bindFilterControls(){
  [["monthFilters","months"],["seasonFilters","seasons"]].forEach(([id,kind])=>{
    $(id).onchange=e=>{
      const input=e.target;if(input.type!=="checkbox")return;
      let selected=kind==="months"?selectedMonths:selectedSeasons;
      if(input.checked)selected=input.value==="all"?["all"]:[...selected.filter(v=>v!=="all"&&v!==input.value),input.value];
      else selected=selected.filter(v=>v!==input.value);
      if(kind==="months")selectedMonths=selected;else selectedSeasons=selected;
      $(id).querySelectorAll("input").forEach(i=>i.checked=selected.includes(i.value));
      updateFilterSummaries();renderRecipeList();
    };
  });
  document.querySelectorAll("[data-clear-filter]").forEach(b=>b.onclick=()=>{if(b.dataset.clearFilter==="months")selectedMonths=[];else selectedSeasons=[];renderFilters();renderRecipeList();});
  document.querySelectorAll("[data-close-filter]").forEach(b=>b.onclick=()=>{const d=b.closest("details");d.open=false;d.querySelector("summary").focus();});
  const dropdowns=[...document.querySelectorAll(".filter-dropdown")];
  dropdowns.forEach(d=>d.ontoggle=()=>{if(d.open)dropdowns.forEach(other=>{if(other!==d)other.open=false;});});
  document.addEventListener("click",e=>{if(!e.target.closest(".filter-bar"))dropdowns.forEach(d=>d.open=false);});
  document.addEventListener("keydown",e=>{if(e.key==="Escape")dropdowns.forEach(d=>{if(d.open){d.open=false;d.querySelector("summary").focus();}});});
}
startApp();
