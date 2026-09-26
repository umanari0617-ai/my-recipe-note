const KEY="myRecipeNoteV1";
const PREPARATION_KEY="restaurantRecipeNoteTodayV1";
const $=id=>document.getElementById(id);

const SERVING_MULT={"1人前":1,"5人前":5,"10人前":10,"1回分":1,"1.5回分":1.5,"2回分":2};
const backTargets={categoryView:"homeView",recipeDetailView:"categoryView",categoryEditView:"categoryView",settingsView:"homeView",supportView:"settingsView",preparationView:"homeView",seasonView:"homeView"};
let preparationDay="";
let preparationTimer;

let state=load();
let currentCategoryId=null;
let currentRecipeId=null;
let currentView="homeView";
const MONTHS=Array.from({length:12},(_,i)=>String(i+1));
const SEASONS=["春","夏","秋","冬"];
const UNITS=["","g","kg","ml","L","個","本","枚","人前","回分","袋","束","大さじ","小さじ","少々","適量"];
const YIELD_UNITS=["人前","回分","g","kg","ml","L","個","本","枚"];
let selectedMonth="",selectedSeason="";
let formAttachments=[];
let imageJobs=0,formSession=0;
let prepRows=[];
let prepFeedbackTimer;
let modalReturnFocus;
let formPhoto="";
let formStages=[];

function defaultState(){
  return{
    categories:[
      {id:"sauce",name:"ソースレシピ"},
      {id:"tare",name:"タレレシピ"},
      {id:"dressing",name:"ドレッシングレシピ"},
      {id:"spice",name:"スパイスレシピ"},
      {id:"side",name:"総菜レシピ"},
      {id:"meat",name:"肉料理レシピ"},
      {id:"fish",name:"魚料理レシピ"}
    ],
    recipes:[]
  };
}
function load(){
  let raw;
  try{raw=localStorage.getItem(KEY);}catch{alert("ブラウザの保存領域を利用できません。保存設定をご確認ください。");return defaultState();}
  if(!raw)return defaultState();
  try{
    const x=JSON.parse(raw);
    if(x&&Array.isArray(x.categories)&&Array.isArray(x.recipes)){
      migrateRecipes(x);
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
    });
    delete r.ingredients;
    delete r.steps;
  });
}
function save(){
  try{
    localStorage.setItem(KEY,JSON.stringify(state));
    return true;
  }catch(e){
    state=load();
    alert("データの保存に失敗しました。空き容量が足りない可能性があります。写真の枚数を減らすか、不要なレシピを削除してから、もう一度お試しください。\nエラー内容："+(e&&e.message?e.message:e));
    return false;
  }
}
function id(){return crypto.randomUUID?crypto.randomUUID():Date.now()+"-"+Math.random().toString(16).slice(2);}
function esc(s){return String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));}

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
  bind();
  refreshPreparationDay();
  schedulePreparationReset();
  renderCategoryList();
  showView("homeView");
}

function bind(){
  document.querySelectorAll("[data-home-action]").forEach(card=>{
    card.onclick=()=>{
      const action=card.dataset.homeAction;
      if(action==="recipes"){
        renderCategoryList();
        showView("categoryView");
      }else if(action==="new"){
        openRecipeForm(null);
      }else if(action==="preparation"){
        refreshPreparationDay();
        showView("preparationView");
        const input=$("preparationRows").querySelector(".prep-name");
        input.focus();
        input.setSelectionRange(input.value.length,input.value.length);
      }else if(action==="season"){
        showView("seasonView");
      }
    };
  });
  $("backButton").onclick=()=>{
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
  $("addPreparationRow").onclick=()=>{if(refreshPreparationDay())return;prepRows.push({name:"",quantity:"",unit:""});renderPrepRows();$("preparationRows").lastElementChild.querySelector("input").focus();prepDirty();};
  $("manageCategories").onclick=()=>{renderCategoryEditList();showView("categoryEditView");};
  $("openSupport").onclick=()=>showView("supportView");
  document.querySelectorAll("[data-import-recipe]").forEach(b=>b.onclick=()=>{openRecipeForm(null);const target=b.dataset.importRecipe==="images"?$("recipeAttachmentsInput"):$("recipeSourceText");target.focus();target.scrollIntoView({block:"center"});});
  $("recipeSearch").oninput=renderRecipeList;
  $("clearRecipeFilters").onclick=()=>{selectedMonth="";selectedSeason="";currentCategoryId=null;$("recipeSearch").value="";renderFilters();renderCategoryList();};
  $("recipeAttachmentsInput").onchange=onAttachmentsChange;
  renderFilters();
  document.addEventListener("keydown",e=>{if(e.key==="Escape"&&!$("recipeFormModal").classList.contains("hidden"))closeModal("recipeForm");});
  const resume=()=>{refreshPreparationDay();schedulePreparationReset();};
  window.addEventListener("focus",resume);
  window.addEventListener("pageshow",resume);
  document.addEventListener("visibilitychange",()=>{if(!document.hidden)resume();});
  window.addEventListener("storage",e=>{
    if(e.key===PREPARATION_KEY||e.key===null){preparationDay="";refreshPreparationDay();}
  });
  $("seasonSearchForm").onsubmit=e=>{
    const ingredient=$("seasonIngredient").value.trim();
    if(!ingredient){e.preventDefault();$("seasonIngredient").value="";$("seasonIngredient").reportValidity();return;}
    $("seasonSearchQuery").value=ingredient+" レシピ";
  };
  $("seasonRegisterButton").onclick=()=>{
    openRecipeForm(null);
    const ingredient=$("seasonIngredient").value.trim();
    if(ingredient){formStages[0].ingredients[0].name=ingredient;renderStages();}
  };
  $("addRecipeButton").onclick=()=>openRecipeForm(null);
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
  document.querySelectorAll("[data-close]").forEach(x=>x.onclick=()=>closeModal(x.dataset.close));
}

function showView(name){
  document.querySelectorAll(".view").forEach(v=>v.classList.add("hidden"));
  $(name).classList.remove("hidden");
  currentView=name;
  $("backButton").classList.toggle("hidden",name==="homeView");
  $("gearButton").classList.toggle("hidden",name!=="homeView"&&name!=="categoryView");
  $("appBrandIcon").classList.toggle("hidden",name!=="homeView");
  $("headerTagline").classList.toggle("hidden",name!=="homeView");
  document.body.classList.toggle("is-home",name==="homeView");
  const titles={homeView:"飲食店レシピノート",categoryView:"レシピ一覧",recipeDetailView:(findRecipe(currentRecipeId)||{}).name||"",categoryEditView:"カテゴリー管理",settingsView:"設定",supportView:"使い方・サポート",preparationView:"今日の仕込み",seasonView:"季節の食材を検索"};
  $("headerTitle").textContent=titles[name]||"飲食店レシピノート";
  $("headerTitle").focus({preventScroll:true});
  window.scrollTo(0,0);
}

/* One local-calendar-day record, separate from recipes and their backups. */
function localDay(date=new Date()){
  return [date.getFullYear(),String(date.getMonth()+1).padStart(2,"0"),String(date.getDate()).padStart(2,"0")].join("-");
}
function refreshPreparationDay(){
  const now=new Date(),today=localDay(now);
  if(preparationDay===today)return false;
  const changed=!!preparationDay;
  preparationDay=today;
  $("preparationDate").dateTime=today;
  $("preparationDate").textContent=new Intl.DateTimeFormat("ja-JP",{year:"numeric",month:"long",day:"numeric",weekday:"long"}).format(now);
  prepRows=[{name:"",quantity:"",unit:""}];
  clearTimeout(prepFeedbackTimer);
  $("preparationSaveButton").textContent="保存";
  $("preparationStatus").textContent=changed?"日付が変わりました。今日の仕込みを入力してください。":"";
  try{
    const raw=localStorage.getItem(PREPARATION_KEY);
    if(raw){
      let record;
      try{record=JSON.parse(raw);}catch{}
      if(record?.date===today){
        if(Array.isArray(record.rows))prepRows=record.rows.map(r=>({name:String(r.name||""),quantity:String(r.quantity??""),unit:String(r.unit||"")}));
        else if(typeof record.text==="string")prepRows=record.text.split("\n").filter(Boolean).map(name=>({name,quantity:"",unit:""}));
      }
      else localStorage.removeItem(PREPARATION_KEY);
    }
  }catch{
    $("preparationStatus").textContent="端末の保存領域を利用できません。ブラウザの設定をご確認ください。";
  }
  renderPrepRows();
  return changed;
}
function schedulePreparationReset(){
  clearTimeout(preparationTimer);
  const now=new Date();
  const midnight=new Date(now.getFullYear(),now.getMonth(),now.getDate()+1);
  preparationTimer=setTimeout(()=>{refreshPreparationDay();schedulePreparationReset();},midnight-now+50);
}
function savePreparation(e){
  e.preventDefault();
  if(refreshPreparationDay())return;
  const rows=prepRows.filter(r=>r.name.trim()||r.quantity||r.unit).map(r=>({...r,name:r.name.trim()}));
  if(rows.some(r=>!r.name)){ $("preparationStatus").textContent="数量・単位を入力した行には仕込み名も入力してください。";return; }
  try{
    localStorage.setItem(PREPARATION_KEY,JSON.stringify({date:preparationDay,rows}));
    $("preparationSaveButton").textContent="✓ 保存しました";
    $("preparationStatus").textContent=new Intl.DateTimeFormat("ja-JP",{hour:"2-digit",minute:"2-digit"}).format(new Date())+" 保存済み";
    clearTimeout(prepFeedbackTimer);
    prepFeedbackTimer=setTimeout(()=>{$("preparationSaveButton").textContent="保存";},3000);
  }catch{
    $("preparationSaveButton").textContent="再度保存する";
    $("preparationStatus").textContent="保存できませんでした。空き容量やブラウザ設定を確認してください。入力内容は残っています。";
  }
}

function categoryName(catId){return state.categories.find(c=>c.id===catId)?.name||"";}
function findRecipe(rid){return state.recipes.find(r=>r.id===rid);}
function recipesInCategory(catId){return state.recipes.filter(r=>r.categoryId===catId);}

/* ---------- category sidebar ---------- */
function renderCategoryList(){
  if(currentCategoryId&&!state.categories.some(c=>c.id===currentCategoryId))currentCategoryId=null;
  $("categoryList").innerHTML=[{id:"",name:"すべて"},...state.categories].map(c=>
    '<li><button type="button" data-id="'+esc(c.id)+'" aria-pressed="'+(c.id===(currentCategoryId||""))+'">'+esc(c.name)+'</button></li>'
  ).join("");
  $("categoryList").querySelectorAll("button").forEach(b=>b.onclick=()=>openCategory(b.dataset.id||null));
  renderRecipeList();
}
function openCategory(catId){
  currentCategoryId=catId;
  renderCategoryList();
}

/* ---------- recipe list ---------- */
function renderRecipeList(){
  const normalize=v=>String(v||"").normalize("NFKC").toLocaleLowerCase();
  const terms=normalize($("recipeSearch").value).trim().split(/\s+/).filter(Boolean);
  const recipes=state.recipes.filter(r=>{
    const haystack=normalize([r.name,...(r.stages||[]).flatMap(s=>s.ingredients.map(i=>i.name))].join(" "));
    return (!currentCategoryId||r.categoryId===currentCategoryId)&&(!selectedMonth||(selectedMonth==="unset"?!(r.months||[]).length:(r.months||[]).map(String).includes(selectedMonth)))&&(!selectedSeason||(selectedSeason==="unset"?!(r.seasons||[]).length:(r.seasons||[]).includes(selectedSeason)))&&terms.every(t=>haystack.includes(t));
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
  $("detailPhotoWrap").classList.toggle("hidden",!r.photo);
  if(r.photo)$("detailPhoto").src=r.photo;
  $("detailName").textContent=r.name;
  $("detailTags").textContent=[...(r.months||[]).map(m=>m+"月"),...(r.seasons||[])].join(" ・ ");
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
    return `<div class="detail-stage">${nameHtml}${ingHtml}${stepsHtml}</div>`;
  }).join("");
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
  input.value="";
  save();
  renderCategoryEditList();
}

/* ---------- data management ---------- */
function exportBackup(){
  const blob=new Blob([JSON.stringify(state,null,2)],{type:"application/json"});
  const a=document.createElement("a");
  a.href=URL.createObjectURL(blob);
  a.download=`飲食店レシピノート_バックアップ_${new Date().toISOString().slice(0,10)}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
}
function importBackup(e){
  const file=e.target.files[0];
  if(!file)return;
  const reader=new FileReader();
  reader.onload=()=>{
    try{
      const x=JSON.parse(reader.result);
      if(!Array.isArray(x.categories)||!Array.isArray(x.recipes))throw 0;
      if(!confirm("現在のデータを、バックアップファイルの内容に置き換えますか？\nこの操作は取り消せません。"))return;
      migrateRecipes(x);
      state=x;
      if(!save())return;
      currentCategoryId=null;
      renderCategoryList();
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
    </div>`).join("");

  formStages.forEach((stage,si)=>{
    const block=$("stagesContainer").querySelector(`.stage-block[data-si="${si}"]`);
    block.querySelector(".stage-name-input").oninput=e=>{stage.groupName=e.target.value;};
    const removeBtn=block.querySelector(".remove-stage");
    if(removeBtn)removeBtn.onclick=()=>removeStage(si);
    block.querySelector(".stage-instruction-input").oninput=e=>{stage.instruction=e.target.value;};
    block.querySelector(".add-ingredient-row").onclick=()=>addIngredientRowToStage(si);
    renderStageIngredientRows(si);
  });
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
  formStages.push({groupName:"",ingredients:[{name:"",amount:""}],instruction:""});
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
  $("recipeYieldUnit").innerHTML=unitOptions(YIELD_UNITS,base.unit);
  renderChecks("recipeMonths",MONTHS,recipe?.months||[],v=>v+"月");
  renderChecks("recipeSeasons",SEASONS,recipe?.seasons||[],v=>v);
  $("recipeSourceText").value=recipe?.sourceText||"";
  formAttachments=[...(recipe?.attachments||[])];
  formSession++;imageJobs=0;setImageBusy();renderAttachments();
  formStages=recipe?.stages?.length?recipe.stages.map(s=>({groupName:s.groupName||"",ingredients:(s.ingredients||[]).map(i=>({...i})),instruction:s.instruction||""})):[{groupName:"",ingredients:[{name:"",amount:""}],instruction:""}];
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
function saveRecipeForm(e){
  e.preventDefault();if(imageJobs)return;
  const name=$("recipeName").value.trim();
  if(!name){$("recipeFormError").textContent="料理名を入力してください。";return;}
  const quantity=Number($("recipeYieldQuantity").value);
  if(!Number.isFinite(quantity)||quantity<=0){$("recipeFormError").textContent="基準量には0より大きい数を入力してください。";return;}
  const categoryId=$("recipeCategory").value;
  const stages=formStages.map(s=>({groupName:s.groupName.trim(),ingredients:s.ingredients.map(i=>({...parseIngredient(i),name:i.name.trim(),amount:ingredientAmount(i,1)})).filter(i=>i.name),instruction:s.instruction.trim()})).filter(s=>s.groupName||s.ingredients.length||s.instruction);
  const data={name,categoryId,photo:formPhoto,attachments:[...formAttachments],sourceText:$("recipeSourceText").value,months:checkedValues("recipeMonths"),seasons:checkedValues("recipeSeasons"),yield:{quantity,unit:$("recipeYieldUnit").value},stages,cookedDate:$("recipeCookedDate").value,cookTime:$("recipeCookTime").value.trim(),memo:$("recipeMemo").value.trim()};
  const existingId=$("recipeId").value;
  const next=JSON.parse(JSON.stringify(state));
  if(existingId){const r=next.recipes.find(r=>r.id===existingId);Object.assign(r,data);delete r.rating;}
  else next.recipes.push({id:id(),...data});
  try{localStorage.setItem(KEY,JSON.stringify(next));}catch{
    $("recipeFormError").textContent="保存できませんでした。入力内容は残っています。画像を減らすか、端末の空き容量を確認してください。";return;
  }
  state=next;closeModal("recipeForm");
  currentCategoryId=categoryId||null;selectedMonth="";selectedSeason="";$("recipeSearch").value="";renderFilters();renderCategoryList();
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
  return [...new Set([...units,selected])].map(u=>'<option value="'+esc(u)+'"'+(u===selected?' selected':'')+'>'+esc(u||"—")+'</option>').join("");
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
  $(id).innerHTML=values.map(v=>'<label><input type="checkbox" value="'+esc(v)+'"'+(selected.map(String).includes(v)?' checked':'')+'><span>'+label(v)+'</span></label>').join("");
}
function checkedValues(id){return [...$(id).querySelectorAll("input:checked")].map(i=>i.value);}
function renderFilters(){
  [["monthFilters",MONTHS,selectedMonth,v=>v+"月"],["seasonFilters",SEASONS,selectedSeason,v=>v]].forEach(([id,values,selected,label])=>{
    $(id).innerHTML=["",...values,"unset"].map(v=>'<button type="button" data-value="'+v+'" aria-pressed="'+(selected===v)+'">'+(v===""?"すべて":v==="unset"?"未設定":label(v))+'</button>').join("");
    $(id).querySelectorAll("button").forEach(b=>b.onclick=()=>{if(id==="monthFilters")selectedMonth=b.dataset.value;else selectedSeason=b.dataset.value;renderFilters();renderRecipeList();});
  });
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
  clearTimeout(prepFeedbackTimer);$("preparationSaveButton").textContent="保存";$("preparationStatus").textContent="未保存の変更があります。";
}
function renderPrepRows(){
  if(!prepRows.length)prepRows=[{name:"",quantity:"",unit:""}];
  $("preparationRows").innerHTML=prepRows.map((r,i)=>'<div class="prep-row"><input class="prep-name" type="text" aria-label="仕込み名 '+(i+1)+'" placeholder="仕込み名" value="'+esc(r.name)+'"><input class="prep-quantity" type="number" inputmode="decimal" min="0" step="any" aria-label="数量 '+(i+1)+'" placeholder="数量" value="'+esc(r.quantity)+'"><select class="prep-unit" aria-label="単位 '+(i+1)+'">'+unitOptions(UNITS,r.unit)+'</select><button type="button" class="remove-row" aria-label="仕込み行 '+(i+1)+' を削除">×</button></div>').join("");
  $("preparationRows").querySelectorAll(".prep-row").forEach((row,i)=>{
    [[".prep-name","name"],[".prep-quantity","quantity"],[".prep-unit","unit"]].forEach(([selector,key])=>row.querySelector(selector).addEventListener("input",e=>{if(refreshPreparationDay())return;prepRows[i][key]=e.target.value;prepDirty();}));
    row.querySelector("button").onclick=()=>{if(refreshPreparationDay())return;prepRows.splice(i,1);renderPrepRows();prepDirty();};
    row.querySelector(".prep-name").onkeydown=e=>{if(e.key==="Enter"&&!e.isComposing){e.preventDefault();if(refreshPreparationDay())return;if(i===prepRows.length-1)prepRows.push({name:"",quantity:"",unit:""});renderPrepRows();$("preparationRows").children[i+1].querySelector("input").focus();prepDirty();}};
    row.querySelector(".prep-name").onpaste=e=>{
      const text=e.clipboardData.getData("text");if(!/[\r\n]/.test(text))return;e.preventDefault();if(refreshPreparationDay())return;
      const lines=text.split(/\r?\n/).map(s=>s.trim()).filter(Boolean);if(!lines.length)return;
      const input=e.target,prefix=input.value.slice(0,input.selectionStart),suffix=input.value.slice(input.selectionEnd);
      lines[0]=prefix+lines[0];lines[lines.length-1]+=suffix;
      prepRows.splice(i,1,...lines.map((name,n)=>({name,quantity:n===0?prepRows[i].quantity:"",unit:n===0?prepRows[i].unit:""})));renderPrepRows();prepDirty();
    };
  });
}
init();
