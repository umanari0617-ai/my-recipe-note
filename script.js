const KEY="myRecipeNoteV1";
const $=id=>document.getElementById(id);

const SERVING_OPTIONS=["1人前","5人前","10人前","1回分","1.5回分","2回分"];
const SERVING_MULT={"1人前":1,"5人前":5,"10人前":10,"1回分":1,"1.5回分":1.5,"2回分":2};
const backTargets={recipeDetailView:"categoryView",categoryEditView:"categoryView"};

let state=load();
let currentCategoryId=null;
let currentRecipeId=null;
let currentView="categoryView";
let formRating=0;
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
  const raw=localStorage.getItem(KEY);
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
  }catch(e){
    alert("データの保存に失敗しました。空き容量が足りない可能性があります。写真の枚数を減らすか、不要なレシピを削除してから、もう一度お試しください。\nエラー内容："+(e&&e.message?e.message:e));
  }
}
function id(){return crypto.randomUUID?crypto.randomUUID():Date.now()+"-"+Math.random().toString(16).slice(2);}
function esc(s){return String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));}

function formatNumber(n){
  const rounded=Math.round(n*100)/100;
  return Number.isInteger(rounded)?String(rounded):String(rounded);
}
function scaleAmountText(text,ratio){
  if(!text)return text;
  if(ratio===1)return text;
  const m=text.match(/(\d+(?:\.\d+)?)/);
  if(!m)return text;
  const scaled=formatNumber(parseFloat(m[1])*ratio);
  return text.slice(0,m.index)+scaled+text.slice(m.index+m[1].length);
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
  renderCategoryList();
  showView("categoryView");
}

function bind(){
  $("backButton").onclick=()=>{
    const target=backTargets[currentView];
    if(target)showView(target);
  };
  $("gearButton").onclick=()=>{renderCategoryEditList();showView("categoryEditView");};
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
  $("backButton").classList.toggle("hidden",name==="categoryView");
  $("gearButton").classList.toggle("hidden",name!=="categoryView");
  const titles={categoryView:"マイレシピノート",recipeDetailView:(findRecipe(currentRecipeId)||{}).name||"",categoryEditView:"カテゴリを編集"};
  $("headerTitle").textContent=titles[name]||"マイレシピノート";
  window.scrollTo(0,0);
}

function categoryName(catId){return state.categories.find(c=>c.id===catId)?.name||"";}
function findRecipe(rid){return state.recipes.find(r=>r.id===rid);}
function recipesInCategory(catId){return state.recipes.filter(r=>r.categoryId===catId);}

/* ---------- category sidebar ---------- */
function renderCategoryList(){
  const list=$("categoryList");
  if(!state.categories.length){
    list.innerHTML=`<li style="border:none;color:var(--muted);">カテゴリが<br>ありません</li>`;
    $("recipeList").innerHTML="";
    $("recipeListEmpty").classList.add("hidden");
    return;
  }
  if(!currentCategoryId||!state.categories.some(c=>c.id===currentCategoryId)){
    currentCategoryId=state.categories[0].id;
  }
  list.innerHTML=state.categories.map(c=>
    `<li data-id="${c.id}" class="${c.id===currentCategoryId?"active":""}">${esc(c.name)}</li>`
  ).join("");
  list.querySelectorAll("li[data-id]").forEach(li=>{
    li.onclick=()=>openCategory(li.dataset.id);
  });
  renderRecipeList();
}
function openCategory(catId){
  currentCategoryId=catId;
  renderCategoryList();
}

/* ---------- recipe list ---------- */
function renderRecipeList(){
  const recipes=recipesInCategory(currentCategoryId);
  $("recipeListEmpty").classList.toggle("hidden",recipes.length>0);
  $("recipeList").innerHTML=recipes.map(r=>{
    const thumb=r.photo?`<img class="recipe-thumb" src="${r.photo}" alt="">`:`<div class="recipe-thumb-placeholder">🍳</div>`;
    const stars=r.rating?"★".repeat(r.rating):"";
    return `<li data-id="${r.id}"><div class="recipe-row-main">${thumb}<span class="recipe-name">${esc(r.name)}</span></div><span class="recipe-row-meta">${stars}</span></li>`;
  }).join("");
  $("recipeList").querySelectorAll("li[data-id]").forEach(li=>{
    li.onclick=()=>openRecipeDetail(li.dataset.id);
  });
}

/* ---------- recipe detail ---------- */
function openRecipeDetail(rid){
  const r=findRecipe(rid);
  if(!r)return;
  currentRecipeId=rid;
  $("detailPhotoWrap").classList.toggle("hidden",!r.photo);
  if(r.photo)$("detailPhoto").src=r.photo;
  $("detailName").textContent=r.name;
  $("detailStars").textContent=r.rating?"★".repeat(r.rating)+"☆".repeat(5-r.rating):"";
  $("detailDate").textContent=r.cookedDate?`作った日：${r.cookedDate}`:"";
  $("detailTime").textContent=r.cookTime?`調理時間：${esc(r.cookTime)}`:"";

  const stages=r.stages||[];
  const hasIngredients=stages.some(s=>(s.ingredients||[]).length>0);
  $("detailServingSelect").innerHTML=SERVING_OPTIONS.map(o=>`<option value="${o}">${o}</option>`).join("");
  $("detailServingSelect").value=r.servingBase||"1人前";
  $("detailServingSelect").onchange=()=>renderDetailStages(r);
  $("detailServingWrap").classList.toggle("hidden",!hasIngredients);

  $("detailStagesWrap").classList.toggle("hidden",!stages.length);
  renderDetailStages(r);

  $("detailMemoWrap").classList.toggle("hidden",!r.memo);
  $("detailMemo").textContent=r.memo||"";
  showView("recipeDetailView");
}
function renderDetailStages(r){
  const target=$("detailServingSelect").value;
  const ratio=SERVING_MULT[target]/SERVING_MULT[r.servingBase||"1人前"];
  const stages=r.stages||[];
  $("detailStages").innerHTML=stages.map(stage=>{
    const nameHtml=stage.groupName?`<div class="detail-stage-name">${esc(stage.groupName)}</div>`:"";
    const ingHtml=stage.ingredients.length?`<h4>材料</h4><ul class="plain-list">${stage.ingredients.map(i=>{
      const amount=scaleAmountText(i.amount,ratio);
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
  a.download=`マイレシピノート_バックアップ_${new Date().toISOString().slice(0,10)}.json`;
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
      save();
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
  const {names,amounts}=ingredientHistory();
  const stage=formStages[si];
  const container=$("stagesContainer").querySelector(`.ingredient-rows[data-si="${si}"]`);
  container.innerHTML=stage.ingredients.map((ing,ii)=>`
    <div class="ingredient-row" data-ii="${ii}">
      <div class="autocomplete-wrap">
        <input type="text" class="name-input" placeholder="材料名（例：醤油）" value="${esc(ing.name)}" autocomplete="off">
        <ul class="suggest-list hidden"></ul>
      </div>
      <div class="autocomplete-wrap amount-wrap">
        <input type="text" class="amount-input" placeholder="分量（例：大さじ2）" value="${esc(ing.amount)}" autocomplete="off">
        <ul class="suggest-list hidden"></ul>
      </div>
      <button type="button" class="remove-row" aria-label="削除">×</button>
    </div>`).join("");
  container.querySelectorAll(".ingredient-row").forEach(row=>{
    const ii=Number(row.dataset.ii);
    const wraps=row.querySelectorAll(".autocomplete-wrap");
    const nameInput=wraps[0].querySelector("input"),nameList=wraps[0].querySelector(".suggest-list");
    const amountInput=wraps[1].querySelector("input"),amountList=wraps[1].querySelector(".suggest-list");
    setupAutocomplete(nameInput,nameList,names,v=>{stage.ingredients[ii].name=v;});
    setupAutocomplete(amountInput,amountList,amounts,v=>{stage.ingredients[ii].amount=v;});
    row.querySelector(".remove-row").onclick=()=>{stage.ingredients.splice(ii,1);renderStageIngredientRows(si);};
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
  $("recipeCategory").innerHTML=state.categories.map(c=>`<option value="${c.id}">${esc(c.name)}</option>`).join("");
  $("recipeCategory").value=recipe?.categoryId||currentCategoryId||state.categories[0]?.id||"";
  $("recipeServingBase").innerHTML=SERVING_OPTIONS.map(o=>`<option value="${o}">${o}</option>`).join("");
  $("recipeServingBase").value=recipe?.servingBase||"1人前";
  formStages=recipe?.stages?.length?recipe.stages.map(s=>({groupName:s.groupName||"",ingredients:(s.ingredients||[]).map(i=>({...i})),instruction:s.instruction||""})):[{groupName:"",ingredients:[{name:"",amount:""}],instruction:""}];
  renderStages();
  $("recipeCookedDate").value=recipe?.cookedDate||"";
  $("recipeCookTime").value=recipe?.cookTime||"";
  $("recipeMemo").value=recipe?.memo||"";
  formRating=recipe?.rating||0;
  formPhoto=recipe?.photo||"";
  renderRatingPicker();
  renderPhotoPreview();
  openModal("recipeForm");
  $("recipeName").focus();
}
function renderRatingPicker(){
  const wrap=$("ratingPicker");
  wrap.innerHTML=[1,2,3,4,5].map(n=>`<span data-n="${n}" class="${n<=formRating?"active":""}">★</span>`).join("");
  wrap.querySelectorAll("span").forEach(s=>{
    s.onclick=()=>{
      const n=Number(s.dataset.n);
      formRating=formRating===n?0:n;
      renderRatingPicker();
    };
  });
}
function renderPhotoPreview(){
  const img=$("recipePhotoPreview");
  const removeBtn=$("removePhotoButton");
  if(formPhoto){img.src=formPhoto;img.classList.remove("hidden");removeBtn.classList.remove("hidden");}
  else{img.classList.add("hidden");removeBtn.classList.add("hidden");}
}
function onPhotoChange(e){
  const file=e.target.files[0];
  if(!file)return;
  compressImage(file).then(dataUrl=>{formPhoto=dataUrl;renderPhotoPreview();}).catch(()=>{alert("写真の読み込みに失敗しました。");});
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
  e.preventDefault();
  const name=$("recipeName").value.trim();
  if(!name){$("recipeFormError").textContent="料理名を入力してください。";return;}
  const categoryId=$("recipeCategory").value;
  const stages=formStages.map(s=>({
    groupName:s.groupName.trim(),
    ingredients:s.ingredients.map(i=>({name:i.name.trim(),amount:i.amount.trim()})).filter(i=>i.name),
    instruction:s.instruction.trim()
  })).filter(s=>s.groupName||s.ingredients.length||s.instruction);
  const data={
    name,categoryId,
    photo:formPhoto,
    rating:formRating,
    servingBase:$("recipeServingBase").value,
    stages,
    cookedDate:$("recipeCookedDate").value,
    cookTime:$("recipeCookTime").value.trim(),
    memo:$("recipeMemo").value.trim()
  };
  const existingId=$("recipeId").value;
  if(existingId){
    const r=findRecipe(existingId);
    Object.assign(r,data);
  }else{
    state.recipes.push({id:id(),...data});
  }
  save();
  closeModal("recipeForm");
  currentCategoryId=categoryId;
  renderCategoryList();
  if(existingId)openRecipeDetail(existingId);
  else showView("categoryView");
}

/* ---------- modal ---------- */
function openModal(name){
  $(name+"Modal").classList.remove("hidden");
  document.body.classList.add("modal-open");
}
function closeModal(name){
  $(name+"Modal").classList.add("hidden");
  document.body.classList.remove("modal-open");
}

init();
