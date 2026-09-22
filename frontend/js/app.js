(function(){
  "use strict";

  var STORAGE_KEY = "books_print_on_demand_ke_state_v1";
  var CURRENCY = "KSh";
  var API_BASE_URL = (window.APP_CONFIG && window.APP_CONFIG.API_BASE_URL) || "";

  function normalizeKenyanPhone(input){
    var digits = String(input || "").replace(/[^\d]/g, "");
    if(digits.length === 9) digits = "254" + digits;
    if(digits.length === 10 && digits.charAt(0) === "0") digits = "254" + digits.slice(1);
    if(digits.length === 12 && digits.slice(0,3) === "254") return digits;
    return null;
  }

  function startMpesaPush(phone, amount, accountReference, description){
    return fetch(API_BASE_URL + "/api/mpesa/stkpush", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phone:phone, amount:amount, accountReference:accountReference, description:description })
    }).then(function(res){ return res.json().then(function(data){ return {ok:res.ok, data:data}; }); });
  }

  function checkMpesaStatus(checkoutRequestId){
    return fetch(API_BASE_URL + "/api/mpesa/status/" + encodeURIComponent(checkoutRequestId))
      .then(function(res){ return res.json().then(function(data){ return {ok:res.ok, data:data}; }); });
  }

  function submitOrderToBackend(order){
    if(!API_BASE_URL) return Promise.resolve(null);
    return fetch(API_BASE_URL + "/api/orders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(order)
    }).then(function(res){ return res.ok ? res.json() : null; }).catch(function(){ return null; });
  }

  function fetchOrdersFromBackend(adminKey){
    if(!API_BASE_URL || !adminKey) return Promise.resolve(null);
    return fetch(API_BASE_URL + "/api/orders", {
      headers: { "x-admin-key": adminKey }
    }).then(function(res){ return res.ok ? res.json() : null; }).catch(function(){ return null; });
  }

  function updateOrderOnBackend(orderId, fields, adminKey){
    if(!API_BASE_URL || !adminKey) return Promise.resolve(null);
    return fetch(API_BASE_URL + "/api/orders/" + encodeURIComponent(orderId), {
      method: "PATCH",
      headers: { "Content-Type": "application/json", "x-admin-key": adminKey },
      body: JSON.stringify(fields)
    }).then(function(res){ return res.ok ? res.json() : null; }).catch(function(){ return null; });
  }

  function deleteOrderOnBackend(orderId, adminKey){
    if(!API_BASE_URL || !adminKey) return Promise.resolve(false);
    return fetch(API_BASE_URL + "/api/orders/" + encodeURIComponent(orderId), {
      method: "DELETE",
      headers: { "x-admin-key": adminKey }
    }).then(function(res){ return res.ok; }).catch(function(){ return false; });
  }

  function normalizeRemoteOrder(o){
    return {
      id:o.id, name:o.name, contact:o.contact, notes:o.notes,
      items: o.items || [], total: Number(o.total),
      status:o.status, paymentStatus:o.payment_status, mpesaCode:o.mpesa_code,
      createdAt: new Date(o.created_at).getTime()
    };
  }

  function pollMpesaStatus(checkoutRequestId, onUpdate, attemptsLeft){
    if(attemptsLeft === undefined) attemptsLeft = 20;
    checkMpesaStatus(checkoutRequestId).then(function(result){
      if(!result.ok){ onUpdate({status:"error", message: (result.data && result.data.error) || "Could not reach the payment server."}); return; }
      var status = result.data.status;
      if(status === "success" || status === "failed"){
        onUpdate(result.data);
      } else if(attemptsLeft <= 1){
        onUpdate({status:"timeout", message:"Still waiting on Safaricom — check your phone, or enter the M-Pesa code manually once you get it."});
      } else {
        onUpdate({status:"pending"});
        setTimeout(function(){ pollMpesaStatus(checkoutRequestId, onUpdate, attemptsLeft - 1); }, 3000);
      }
    }).catch(function(err){
      onUpdate({status:"error", message: "Network error while checking payment status."});
    });
  }

  var defaultState = {
    passHash: null,
    settings: {
      whatsappNumber: "254707168899",
      mpesaInstructions: "Buy Goods Till Number: 5356215\nEpiq Graphics",
      adminApiKey: ""
    },
    quote: {
      sizeDivisor: { A4:4, A5:8 },
      colourMultiplier: { bw:1, colour:1.5 },
      bindingDiscount: { stepQty:20, stepPercent:10, floorPercent:70 },
      bulkDiscount: { thresholdQty:100, percent:5 },
      minimumOrder: 500,
      insertMaterials: [
        {id:"plain80", name:"80gsm White Paper (Photocopy Paper)", baseRate:8, colourSensitive:true},
        {id:"cream80", name:"80gsm Book Paper (Cream)", baseRate:12, colourSensitive:true},
        {id:"art115", name:"115gsm Artpaper", baseRate:35, colourSensitive:false},
        {id:"art135", name:"135gsm Artpaper", baseRate:40, colourSensitive:false},
        {id:"art150", name:"150gsm Artpaper", baseRate:45, colourSensitive:false},
        {id:"art170", name:"170gsm Artpaper", baseRate:50, colourSensitive:false},
        {id:"art200", name:"200gsm Artpaper", baseRate:55, colourSensitive:false},
        {id:"art250", name:"250gsm Artpaper", baseRate:60, colourSensitive:false},
        {id:"art300", name:"300gsm Artpaper", baseRate:65, colourSensitive:false},
        {id:"art350", name:"350gsm Artpaper", baseRate:80, colourSensitive:false}
      ],
      bindingOptions: [
        {id:"stitch", name:"Stitching", bindingCost:50},
        {id:"perfect-glue", name:"Perfect (Hot Glue)", bindingCost:100},
        {id:"spiral-soft", name:"Spiral (Softcover)", bindingCost:50},
        {id:"spiral-hard", name:"Spiral (Hardcover)", bindingCost:100},
        {id:"perfect-hardcase", name:"Perfect Hardcase", bindingCost:180}
      ],
      laminationOptions: [
        {id:"matt", name:"Matt", price:15},
        {id:"gloss", name:"Gloss", price:15},
        {id:"none", name:"No Lamination", price:0}
      ]
    },
    orders: []
  };

  var state = loadState();
  var isAdmin = false;
  var cart = {};
  var printType = "bw";
  var initialDefaultsApplied = false;
  var DEFAULT_COVER_PAPER_ID = "art300";
  var DEFAULT_BINDING_ID = "perfect-glue";

  function loadState(){
    try{
      var raw = localStorage.getItem(STORAGE_KEY);
      if(!raw){ saveState(defaultState); return JSON.parse(JSON.stringify(defaultState)); }
      var parsed = JSON.parse(raw);
      if(!parsed.quote || !parsed.orders) throw new Error("bad shape");
      if(!parsed.quote.sizeDivisor || !parsed.quote.bindingDiscount || !parsed.quote.bulkDiscount){
        parsed.quote = JSON.parse(JSON.stringify(defaultState.quote));
      }
      if(parsed.quote.insertMaterials){
        parsed.quote.insertMaterials.forEach(function(m){
          if(typeof m.colourSensitive !== "boolean"){
            m.colourSensitive = !/artpaper/i.test(m.name);
          }
        });
      }
      if(!parsed.settings){ parsed.settings = JSON.parse(JSON.stringify(defaultState.settings)); }
      if(!parsed.settings.whatsappNumber){ parsed.settings.whatsappNumber = defaultState.settings.whatsappNumber; }
      if(!parsed.settings.mpesaInstructions){ parsed.settings.mpesaInstructions = defaultState.settings.mpesaInstructions; }
      if(typeof parsed.settings.adminApiKey !== "string"){ parsed.settings.adminApiKey = ""; }
      if(typeof parsed.quote.minimumOrder !== "number"){ parsed.quote.minimumOrder = defaultState.quote.minimumOrder; }
      return parsed;
    }catch(e){
      saveState(defaultState);
      return JSON.parse(JSON.stringify(defaultState));
    }
  }
  function saveState(s){ try{ localStorage.setItem(STORAGE_KEY, JSON.stringify(s)); }catch(e){ console.error("Could not save", e); } }
  function persist(){ saveState(state); }

  function fmt(n){ n = Math.round(Number(n) || 0); return CURRENCY + " " + n.toLocaleString("en-KE"); }
  function simpleHash(str){ var h=0; for(var i=0;i<str.length;i++){ h=((h<<5)-h)+str.charCodeAt(i); h|=0; } return "h"+h; }
  function escapeHtml(s){ return String(s).replace(/[&<>"']/g, function(c){ return ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[c]; }); }
  function toast(msg){
    var t = document.getElementById("toast");
    t.textContent = msg; t.classList.add("show");
    clearTimeout(t._timer);
    t._timer = setTimeout(function(){ t.classList.remove("show"); }, 2200);
  }

  /* ---------------- print type toggle ---------------- */
  document.getElementById("pt-bw").addEventListener("click", function(){
    printType = "bw";
    document.getElementById("pt-bw").classList.add("active");
    document.getElementById("pt-colour").classList.remove("active");
  });
  document.getElementById("pt-colour").addEventListener("click", function(){
    printType = "colour";
    document.getElementById("pt-colour").classList.add("active");
    document.getElementById("pt-bw").classList.remove("active");
  });

  /* ---------------- quote generator ---------------- */

  function pageRate(material, size, colour){
    var divisor = (state.quote.sizeDivisor && state.quote.sizeDivisor[size]) || 1;
    var rate = material.baseRate / divisor;
    if(material.colourSensitive !== false){
      var colourMult = (state.quote.colourMultiplier && state.quote.colourMultiplier[colour]) || 1;
      rate = rate * colourMult;
    }
    return rate;
  }

  function bindingCostFor(bindingOpt, qty){
    var d = state.quote.bindingDiscount || {stepQty:20, stepPercent:10, floorPercent:70};
    var tier = Math.floor(qty / d.stepQty);
    var raw = bindingOpt.bindingCost * Math.pow(1 - (d.stepPercent/100), tier);
    var floor = bindingOpt.bindingCost * (d.floorPercent/100);
    return Math.max(floor, raw);
  }

  function renderOptions(){
    var insertSel = document.getElementById("pq-insert");
    var coverSel = document.getElementById("pq-cover-paper");
    var bindingSel = document.getElementById("pq-binding");
    var lamSel = document.getElementById("pq-lamination");
    if(!insertSel || !coverSel || !bindingSel || !lamSel) return;
    var prevInsert = insertSel.value, prevCover = coverSel.value, prevBinding = bindingSel.value, prevLam = lamSel.value;

    insertSel.innerHTML = "";
    coverSel.innerHTML = "";
    state.quote.insertMaterials.forEach(function(m){
      var o1 = document.createElement("option"); o1.value = m.id; o1.textContent = m.name; insertSel.appendChild(o1);
      var o2 = document.createElement("option"); o2.value = m.id; o2.textContent = m.name; coverSel.appendChild(o2);
    });
    bindingSel.innerHTML = "";
    state.quote.bindingOptions.forEach(function(m){
      var o = document.createElement("option"); o.value = m.id; o.textContent = m.name; bindingSel.appendChild(o);
    });
    lamSel.innerHTML = "";
    state.quote.laminationOptions.forEach(function(m){
      var o = document.createElement("option"); o.value = m.id; o.textContent = m.name; lamSel.appendChild(o);
    });

    if(prevInsert && state.quote.insertMaterials.some(function(m){return m.id===prevInsert;})) insertSel.value = prevInsert;
    if(prevCover && state.quote.insertMaterials.some(function(m){return m.id===prevCover;})) coverSel.value = prevCover;
    if(prevBinding && state.quote.bindingOptions.some(function(m){return m.id===prevBinding;})) bindingSel.value = prevBinding;
    if(prevLam && state.quote.laminationOptions.some(function(m){return m.id===prevLam;})) lamSel.value = prevLam;

    if(!initialDefaultsApplied){
      if(state.quote.insertMaterials.some(function(m){return m.id===DEFAULT_COVER_PAPER_ID;})){
        coverSel.value = DEFAULT_COVER_PAPER_ID;
      }
      if(state.quote.bindingOptions.some(function(m){return m.id===DEFAULT_BINDING_ID;})){
        bindingSel.value = DEFAULT_BINDING_ID;
      }
      initialDefaultsApplied = true;
    }

    var minNote = document.getElementById("pq-min-note");
    if(minNote){
      var minOrder = state.quote.minimumOrder || 0;
      minNote.textContent = minOrder > 0 ? "Minimum order value: " + fmt(minOrder) + " per request." : "";
    }
  }

  function computeQuote(){
    var size = document.getElementById("pq-size").value || "A5";
    var pages = Math.max(1, Math.round(Number(document.getElementById("pq-pages").value) || 0));
    var qty = Math.max(1, Math.round(Number(document.getElementById("pq-qty").value) || 0));
    var insertId = document.getElementById("pq-insert").value;
    var coverId = document.getElementById("pq-cover-paper").value;
    var bindingId = document.getElementById("pq-binding").value;
    var lamId = document.getElementById("pq-lamination").value;
    var insert = state.quote.insertMaterials.find(function(m){ return m.id === insertId; });
    var cover = state.quote.insertMaterials.find(function(m){ return m.id === coverId; });
    var binding = state.quote.bindingOptions.find(function(m){ return m.id === bindingId; });
    var lamination = state.quote.laminationOptions.find(function(m){ return m.id === lamId; });
    var result = document.getElementById("pq-result");
    if(!pages || !insert || !cover || !binding || !lamination){
      result.innerHTML = '<div class="bq-result"><p class="empty-note">Enter a page count and pick your options to see a quote.</p></div>';
      return;
    }
    var insertRate = pageRate(insert, size, printType);
    var insertCost = Math.round(pages * insertRate);
    var coverRate = pageRate(cover, size, printType);
    var coverCost = Math.round(coverRate);
    var bindingCost = Math.round(bindingCostFor(binding, qty));
    var lamCost = Math.round(lamination.price || 0);
    var perCopyBeforeBulk = insertCost + coverCost + bindingCost + lamCost;

    var bulk = state.quote.bulkDiscount || {thresholdQty:100, percent:5};
    var perCopy = qty > bulk.thresholdQty ? Math.round(perCopyBeforeBulk * (1 - bulk.percent/100)) : Math.round(perCopyBeforeBulk);
    var total = Math.round(perCopy * qty);

    var minOrder = state.quote.minimumOrder || 0;
    var minApplied = false;
    if(total < minOrder){
      total = minOrder;
      perCopy = Math.round(total / qty);
      minApplied = true;
    }

    result.innerHTML =
      '<div class="bq-result">' +
        '<div class="bq-line"><span>Cost per book</span><strong>' + fmt(perCopy) + '</strong></div>' +
        '<div class="bq-total-line"><span>Total for ' + qty + ' ' + (qty===1?"copy":"copies") + '</span><span>' + fmt(total) + '</span></div>' +
        (minApplied ? '<p class="bq-note">Minimum order value of ' + fmt(minOrder) + ' applied to this request.</p>' : '') +
        '<p class="bq-note">Provisional quote — subject to confirmation once we review your final files and specs.</p>' +
        '<div class="bq-actions"><button class="btn btn-solid btn-sm" id="pq-add-btn" type="button">Add to request</button></div>' +
      '</div>';

    document.getElementById("pq-add-btn").addEventListener("click", function(){
      var id = "q_" + Date.now().toString(36);
      var item = {
        id:id,
        name:"Book — " + size + ", " + pages + "pp, " + insert.name + " (" + (printType==="colour"?"Colour":"B&W") + ") / Cover: " + cover.name + " / " + binding.name + " / " + lamination.name,
        desc:qty + " " + (qty===1?"copy":"copies") + " · provisional",
        price:perCopy,
        unit:"per copy"
      };
      cart[id] = {qty:qty, item:item};
      renderOrderPanel();
      toast("Quote added to your request");
    });
  }
  document.getElementById("pq-generate-btn").addEventListener("click", computeQuote);

  /* ---------------- order/request panel ---------------- */

  function renderOrderPanel(){
    var list = document.getElementById("order-list");
    var empty = document.getElementById("order-empty");
    list.innerHTML = "";
    var ids = Object.keys(cart);
    var total = 0;
    if(ids.length === 0){
      empty.style.display = "block";
    } else {
      empty.style.display = "none";
      ids.forEach(function(id){
        var line = cart[id];
        var lineTotal = line.qty * line.item.price;
        total += lineTotal;
        var li = document.createElement("li");
        li.className = "order-line";
        var left = document.createElement("div");
        left.innerHTML = '<div class="l-name">' + escapeHtml(line.item.name) + '</div><div class="l-meta">' + line.qty + ' × ' + fmt(line.item.price) + '</div>';
        var right = document.createElement("div");
        right.style.textAlign = "right";
        var removeBtn = document.createElement("button");
        removeBtn.className = "remove"; removeBtn.type="button"; removeBtn.textContent = "remove";
        removeBtn.addEventListener("click", function(){ delete cart[id]; renderOrderPanel(); });
        var amt = document.createElement("div");
        amt.style.fontWeight = "700"; amt.style.fontSize="13.5px";
        amt.textContent = fmt(lineTotal);
        right.appendChild(amt); right.appendChild(removeBtn);
        li.appendChild(left); li.appendChild(right);
        list.appendChild(li);
      });
    }
    document.getElementById("order-total").textContent = fmt(total);
    document.getElementById("submit-order-btn").disabled = ids.length === 0;
  }

  function buildWhatsAppLink(order){
    var number = (state.settings.whatsappNumber || "").replace(/[^\d]/g, "");
    var itemsStr = order.items.map(function(l){ return l.qty + "x " + l.name; }).join("; ");
    var lines = [
      "Hi, I'd like to confirm my print order.",
      "Ref: #" + order.id,
      "Items: " + itemsStr,
      "Total: " + fmt(order.total),
      "M-Pesa code: " + (order.mpesaCode ? order.mpesaCode : "not sent yet"),
      "Name: " + order.name,
      "Contact: " + order.contact
    ];
    if(order.notes) lines.push("Notes: " + order.notes);
    var text = encodeURIComponent(lines.join("\n"));
    return number ? ("https://wa.me/" + number + "?text=" + text) : null;
  }

  function renderConfirmBox(order){
    var box = document.getElementById("confirm-box");
    box.style.display = "block";

    var waLink = buildWhatsAppLink(order);
    var mpesa = state.settings.mpesaInstructions || "";
    var pushEnabled = !!API_BASE_URL;
    var isPaid = order.paymentStatus === "Paid";
    var guessedPhone = normalizeKenyanPhone(order.contact) || "";

    box.innerHTML =
      '<div class="confirm-box">' +
        '<div>Request received. We will confirm by ' + escapeHtml(order.contact) + '.</div>' +
        '<div style="margin-top:8px;">Reference <span class="id">#' + order.id + '</span> · ' + fmt(order.total) + '</div>' +

        (isPaid ?
          '<div style="margin-top:16px; padding-top:16px; border-top:1px solid var(--paper); font-weight:700; color:var(--orange);">Payment received — M-Pesa code ' + escapeHtml(order.mpesaCode || "") + '</div>'
        :
          '<div style="margin-top:16px; padding-top:16px; border-top:1px solid var(--paper);">' +
            '<div style="font-weight:700; margin-bottom:6px;">Pay via M-Pesa</div>' +

            (pushEnabled ?
              '<div class="field" style="margin-bottom:10px;">' +
                '<label for="mpesa-phone-input">M-Pesa phone number</label>' +
                '<input type="text" id="mpesa-phone-input" placeholder="07XXXXXXXX" value="' + escapeHtml(guessedPhone) + '">' +
              '</div>' +
              '<button class="btn btn-orange btn-sm" id="mpesa-push-btn" type="button">Pay ' + fmt(order.total) + ' now</button>' +
              '<div id="mpesa-push-status" style="margin-top:10px; font-size:13px; color:var(--ink-soft);"></div>' +
              '<div style="margin:14px 0; font-size:11.5px; color:var(--ink-soft);">— or pay manually —</div>'
            : '') +

            (mpesa ? '<div style="color:var(--ink-soft); font-size:13.5px; white-space:pre-line;">' + escapeHtml(mpesa) + '</div>' : '') +
            '<div style="margin-top:10px;">Amount: <strong>' + fmt(order.total) + '</strong> · Account/Reference: <strong>' + order.id + '</strong></div>' +
            '<div class="field" style="margin-top:12px;">' +
              '<label for="mpesa-code-input">M-Pesa confirmation code (once paid)</label>' +
              '<input type="text" id="mpesa-code-input" placeholder="e.g. QAI7XXXXXX" value="' + escapeHtml(order.mpesaCode || "") + '">' +
            '</div>' +
            '<button class="btn btn-sm" id="save-mpesa-code-btn" type="button" style="margin-top:8px;">Save code</button>' +
          '</div>'
        ) +

        (waLink ?
          '<div style="margin-top:16px;"><a class="btn btn-orange" href="' + waLink + '" target="_blank" rel="noopener">Send confirmation via WhatsApp</a></div>'
        : '') +
        '<button class="btn btn-sm" id="new-order-btn" style="margin-top:14px;">Start another quote</button>' +
      '</div>';

    var codeInput = document.getElementById("mpesa-code-input");
    if(codeInput){
      document.getElementById("save-mpesa-code-btn").addEventListener("click", function(){
        order.mpesaCode = codeInput.value.trim();
        persist();
        if(API_BASE_URL){
          fetch(API_BASE_URL + "/api/orders/" + encodeURIComponent(order.id) + "/mpesa-code", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ code: order.mpesaCode })
          }).catch(function(){ /* best effort — local copy is already saved */ });
        }
        renderAdminOrders();
        renderConfirmBox(order);
        toast("M-Pesa code saved");
      });
    }

    var pushBtn = document.getElementById("mpesa-push-btn");
    if(pushBtn){
      pushBtn.addEventListener("click", function(){
        var phoneRaw = document.getElementById("mpesa-phone-input").value;
        var phone = normalizeKenyanPhone(phoneRaw);
        var statusEl = document.getElementById("mpesa-push-status");
        if(!phone){ statusEl.textContent = "Enter a valid Safaricom number, e.g. 07XXXXXXXX."; return; }
        pushBtn.disabled = true;
        statusEl.textContent = "Sending payment request to your phone…";
        startMpesaPush(phone, order.total, order.id, "Books Print on Demand KE order " + order.id).then(function(result){
          if(!result.ok || !result.data || !result.data.checkoutRequestId){
            statusEl.textContent = (result.data && result.data.error) || "Could not start the M-Pesa push. Try the manual option below.";
            pushBtn.disabled = false;
            return;
          }
          statusEl.textContent = "Check your phone and enter your M-Pesa PIN…";
          pollMpesaStatus(result.data.checkoutRequestId, function(update){
            if(update.status === "success"){
              order.paymentStatus = "Paid";
              order.mpesaCode = update.receipt || order.mpesaCode;
              order.status = "In progress";
              persist();
              renderAdminOrders();
              renderConfirmBox(order);
              toast("Payment received — thank you!");
            } else if(update.status === "failed"){
              statusEl.textContent = "Payment was not completed (" + (update.message || "cancelled") + "). You can try again or pay manually below.";
              pushBtn.disabled = false;
            } else if(update.status === "timeout" || update.status === "error"){
              statusEl.textContent = update.message || "We lost track of that payment — please pay manually below and enter your code.";
              pushBtn.disabled = false;
            } else {
              statusEl.textContent = "Waiting for confirmation from Safaricom…";
            }
          });
        }).catch(function(){
          statusEl.textContent = "Could not reach the payment server. Try the manual option below.";
          pushBtn.disabled = false;
        });
      });
    }

    document.getElementById("new-order-btn").addEventListener("click", function(){
      box.style.display = "none"; box.innerHTML = "";
      document.getElementById("order-form").style.display = "flex";
    });
  }

  document.getElementById("order-form").addEventListener("submit", function(e){
    e.preventDefault();
    var ids = Object.keys(cart);
    if(ids.length === 0) return;
    var name = document.getElementById("c-name").value.trim();
    var contact = document.getElementById("c-contact").value.trim();
    var notes = document.getElementById("c-notes").value.trim();
    if(!name || !contact){ toast("Add your name and a way to reach you"); return; }

    var items = ids.map(function(id){
      var l = cart[id];
      return {name:l.item.name, qty:l.qty, price:l.item.price};
    });
    var total = items.reduce(function(sum,i){ return sum + i.qty*i.price; }, 0);
    var order = {
      id: Date.now().toString(36).toUpperCase(),
      createdAt: Date.now(),
      name:name, contact:contact, notes:notes,
      items:items, total:total, status:"New"
    };
    state.orders.push(order);
    persist();
    submitOrderToBackend(order); // best-effort; local copy is already saved either way

    cart = {};
    document.getElementById("order-form").reset();
    document.getElementById("order-form").style.display = "none";
    renderConfirmBox(order);
    renderOrderPanel();
    renderAdminOrders();
  });

  function renderAdminOrders(){
    if(!isAdmin) return;
    var adminKey = state.settings.adminApiKey;
    var countEl = document.getElementById("orders-count");

    if(API_BASE_URL && adminKey){
      fetchOrdersFromBackend(adminKey).then(function(data){
        if(data){
          var normalized = data.map(normalizeRemoteOrder);
          countEl.textContent = normalized.length + " request" + (normalized.length===1?"":"s") + " · synced";
          renderOrderCards(normalized, true);
        } else {
          countEl.textContent = state.orders.length + " request" + (state.orders.length===1?"":"s") + " · backend unreachable, showing local";
          renderOrderCards(state.orders, false);
        }
      });
    } else {
      countEl.textContent = state.orders.length + " request" + (state.orders.length===1?"":"s") + (API_BASE_URL ? " · add your admin key to sync" : "");
      renderOrderCards(state.orders, false);
    }
  }

  function renderOrderCards(list, isRemote){
    var wrap = document.getElementById("orders-list");
    wrap.innerHTML = "";
    if(list.length === 0){ wrap.innerHTML = '<p class="empty-note">No quote requests submitted yet.</p>'; return; }
    list.slice().reverse().forEach(function(order){
      var card = document.createElement("div");
      card.className = "order-card";
      var statusClass = order.status === "New" ? "status-new" : order.status === "In progress" ? "status-progress" : "status-done";
      var itemsStr = order.items.map(function(l){ return l.qty + "× " + l.name; }).join(", ");
      card.innerHTML =
        '<div class="order-card-top">' +
          '<div><span class="oid">#' + order.id + '</span> <span class="status-badge ' + statusClass + '">' + order.status + '</span></div>' +
          '<div class="meta">' + new Date(order.createdAt).toLocaleString() + '</div>' +
        '</div>' +
        '<div><strong>' + escapeHtml(order.name) + '</strong> · ' + escapeHtml(order.contact) + '</div>' +
        '<div class="order-items-line">' + escapeHtml(itemsStr) + '</div>' +
        (order.notes ? '<div class="order-items-line">Notes: ' + escapeHtml(order.notes) + '</div>' : '') +
        (order.mpesaCode ? '<div class="order-items-line">M-Pesa code: <strong>' + escapeHtml(order.mpesaCode) + '</strong>' + (order.paymentStatus === "Paid" ? ' · <span style="color:var(--orange); font-weight:700;">Paid via push</span>' : '') + '</div>' : '<div class="order-items-line">M-Pesa code: not received</div>') +
        '<div style="font-weight:800;">' + fmt(order.total) + '</div>';

      var actions = document.createElement("div");
      actions.className = "order-actions";
      var sel = document.createElement("select");
      sel.className = "status-select";
      ["New","In progress","Done"].forEach(function(s){
        var o = document.createElement("option"); o.value = s; o.textContent = s;
        if(s === order.status) o.selected = true;
        sel.appendChild(o);
      });
      sel.addEventListener("change", function(){
        var newStatus = sel.value;
        if(isRemote){
          updateOrderOnBackend(order.id, {status:newStatus}, state.settings.adminApiKey).then(function(){ renderAdminOrders(); });
        } else {
          var local = state.orders.find(function(o){ return o.id === order.id; });
          if(local) local.status = newStatus;
          persist(); renderAdminOrders();
        }
      });
      var delOrderBtn = document.createElement("button");
      delOrderBtn.className = "btn btn-danger btn-sm"; delOrderBtn.textContent = "Delete";
      delOrderBtn.addEventListener("click", function(){
        if(!confirm("Delete request #" + order.id + "?")) return;
        if(isRemote){
          deleteOrderOnBackend(order.id, state.settings.adminApiKey).then(function(){ renderAdminOrders(); });
        } else {
          state.orders = state.orders.filter(function(o){ return o.id !== order.id; });
          persist(); renderAdminOrders();
        }
      });
      actions.appendChild(sel); actions.appendChild(delOrderBtn);
      card.appendChild(actions);
      wrap.appendChild(card);
    });
  }

  /* ---------------- admin rates panel ---------------- */

  function renderAdminRates(){
    var wrap = document.getElementById("pq-admin-rates");
    if(!wrap) return;
    if(!isAdmin){ wrap.innerHTML = ""; return; }

    function insertRow(entity){
      var r = document.createElement("div");
      r.className = "rate-row";
      var nameInput = document.createElement("input");
      nameInput.type = "text"; nameInput.value = entity.name;
      nameInput.addEventListener("change", function(){ entity.name = nameInput.value.trim() || entity.name; persist(); renderOptions(); });

      var rateInput = document.createElement("input");
      rateInput.type = "number"; rateInput.min = "0"; rateInput.step = "0.5"; rateInput.value = entity.baseRate;
      rateInput.addEventListener("change", function(){
        entity.baseRate = Math.max(0, Number(rateInput.value) || 0);
        rateInput.value = entity.baseRate; persist(); toast(entity.name + " updated");
      });
      var rateLbl = document.createElement("span"); rateLbl.className = "rate-unit-label";
      rateLbl.textContent = "/ sheet";

      var chkLabel = document.createElement("label");
      chkLabel.className = "chk";
      var chk = document.createElement("input"); chk.type = "checkbox"; chk.checked = entity.colourSensitive !== false;
      chk.addEventListener("change", function(){
        entity.colourSensitive = chk.checked;
        persist(); toast(entity.name + " updated");
      });
      chkLabel.appendChild(chk); chkLabel.appendChild(document.createTextNode("colour affects price"));

      var delBtn = document.createElement("button");
      delBtn.type = "button"; delBtn.className = "remove-btn"; delBtn.textContent = "remove";
      delBtn.addEventListener("click", function(){
        state.quote.insertMaterials = state.quote.insertMaterials.filter(function(m){ return m.id !== entity.id; });
        persist(); renderAdminRates(); renderOptions();
      });
      r.appendChild(nameInput); r.appendChild(rateInput); r.appendChild(rateLbl); r.appendChild(chkLabel); r.appendChild(delBtn);
      return r;
    }

    function bindingRow(entity){
      var r = document.createElement("div");
      r.className = "rate-row";
      var nameInput = document.createElement("input");
      nameInput.type = "text"; nameInput.value = entity.name;
      nameInput.addEventListener("change", function(){ entity.name = nameInput.value.trim() || entity.name; persist(); renderOptions(); });

      var costInput = document.createElement("input");
      costInput.type = "number"; costInput.min = "0"; costInput.value = entity.bindingCost;
      costInput.addEventListener("change", function(){
        entity.bindingCost = Math.max(0, Math.round(Number(costInput.value) || 0));
        costInput.value = entity.bindingCost; persist(); toast(entity.name + " updated");
      });
      var lbl = document.createElement("span"); lbl.className = "rate-unit-label"; lbl.textContent = "starting / copy";

      var delBtn = document.createElement("button");
      delBtn.type="button"; delBtn.className="remove-btn"; delBtn.textContent="remove";
      delBtn.addEventListener("click", function(){
        state.quote.bindingOptions = state.quote.bindingOptions.filter(function(m){ return m.id !== entity.id; });
        persist(); renderAdminRates(); renderOptions();
      });
      r.appendChild(nameInput); r.appendChild(costInput); r.appendChild(lbl); r.appendChild(delBtn);
      return r;
    }

    function laminationRow(entity){
      var r = document.createElement("div");
      r.className = "rate-row";
      var nameInput = document.createElement("input");
      nameInput.type = "text"; nameInput.value = entity.name;
      nameInput.addEventListener("change", function(){ entity.name = nameInput.value.trim() || entity.name; persist(); renderOptions(); });
      var priceInput = document.createElement("input");
      priceInput.type = "number"; priceInput.min = "0"; priceInput.value = entity.price;
      priceInput.addEventListener("change", function(){
        entity.price = Math.max(0, Math.round(Number(priceInput.value) || 0));
        priceInput.value = entity.price; persist(); toast(entity.name + " updated");
      });
      var lbl = document.createElement("span"); lbl.className = "rate-unit-label"; lbl.textContent = "/ copy";
      var delBtn = document.createElement("button");
      delBtn.type = "button"; delBtn.className = "remove-btn"; delBtn.textContent = "remove";
      delBtn.addEventListener("click", function(){
        state.quote.laminationOptions = state.quote.laminationOptions.filter(function(m){ return m.id !== entity.id; });
        persist(); renderAdminRates(); renderOptions();
      });
      r.appendChild(nameInput); r.appendChild(priceInput); r.appendChild(lbl); r.appendChild(delBtn);
      return r;
    }

    wrap.innerHTML = "";
    var panel = document.createElement("div");
    panel.className = "rates-panel";
    panel.innerHTML = '<h4>Quote rates (studio only)</h4><div class="sub">Editable pricing behind the calculator — clients only ever see the final cost per book and total.</div>';

    var cols = document.createElement("div");
    cols.className = "rates-columns";

    var insertCol = document.createElement("div");
    insertCol.innerHTML = '<div style="font-weight:700; font-size:13.5px; margin-bottom:8px;">Insert paper</div>';
    state.quote.insertMaterials.forEach(function(m){ insertCol.appendChild(insertRow(m)); });
    var addInsertRow = document.createElement("div");
    addInsertRow.className = "add-rate-row";
    addInsertRow.innerHTML = '<input type="text" placeholder="Paper name" data-f="name"><input type="number" placeholder="Rate/page" min="0" step="0.5" data-f="rate"><button class="btn btn-sm" type="button">Add</button>';
    addInsertRow.querySelector("button").addEventListener("click", function(){
      var name = addInsertRow.querySelector('[data-f="name"]').value.trim();
      var rate = Math.max(0, Number(addInsertRow.querySelector('[data-f="rate"]').value) || 0);
      if(!name){ toast("Give the paper a name first"); return; }
      state.quote.insertMaterials.push({id:"im_"+Date.now().toString(36), name:name, baseRate:rate, sizeColourSensitive:false});
      persist(); renderAdminRates(); renderOptions();
    });
    insertCol.appendChild(addInsertRow);

    function settingRow(labelText, value, min, step, onSave, borderTop){
      var row = document.createElement("div");
      row.className = "binding-fee-row";
      if(borderTop === false){ row.style.borderTop = "none"; row.style.paddingTop = "0"; }
      row.style.marginTop = "10px";
      var lbl = document.createElement("label"); lbl.textContent = labelText;
      var inp = document.createElement("input");
      inp.type = "number"; inp.min = String(min); inp.step = String(step);
      inp.value = value;
      inp.addEventListener("change", function(){
        var v = onSave(Number(inp.value));
        inp.value = v; persist();
        toast(labelText + " updated");
      });
      row.appendChild(lbl); row.appendChild(inp);
      return row;
    }

    var sheetNote = document.createElement("div");
    sheetNote.style.fontWeight = "700"; sheetNote.style.fontSize = "13px"; sheetNote.style.marginTop = "14px";
    sheetNote.textContent = "Sheet → page pricing";
    insertCol.appendChild(sheetNote);
    insertCol.appendChild(settingRow("A4 pages per sheet (÷)", state.quote.sizeDivisor.A4, 1, 1, function(v){
      state.quote.sizeDivisor.A4 = Math.max(1, Math.round(v) || 4); renderOptions(); return state.quote.sizeDivisor.A4;
    }, false));
    insertCol.appendChild(settingRow("A5 pages per sheet (÷)", state.quote.sizeDivisor.A5, 1, 1, function(v){
      state.quote.sizeDivisor.A5 = Math.max(1, Math.round(v) || 8); renderOptions(); return state.quote.sizeDivisor.A5;
    }, false));
    insertCol.appendChild(settingRow("Colour price × (of B&W)", state.quote.colourMultiplier.colour, 1, 0.5, function(v){
      state.quote.colourMultiplier.colour = Math.max(1, v || 1.5); return state.quote.colourMultiplier.colour;
    }, false));
    var multNote = document.createElement("div");
    multNote.style.fontSize = "11px"; multNote.style.color = "var(--ink-soft)"; multNote.style.marginTop = "8px";
    multNote.textContent = "Every paper's per-page price = its rate above ÷ the size divisor, × the colour multiplier if Colour is selected.";
    insertCol.appendChild(multNote);

    var bulkNote = document.createElement("div");
    bulkNote.style.fontWeight = "700"; bulkNote.style.fontSize = "13px"; bulkNote.style.marginTop = "18px";
    bulkNote.textContent = "Bulk order discount";
    insertCol.appendChild(bulkNote);
    insertCol.appendChild(settingRow("Applies above qty", state.quote.bulkDiscount.thresholdQty, 1, 1, function(v){
      state.quote.bulkDiscount.thresholdQty = Math.max(1, Math.round(v) || 100); return state.quote.bulkDiscount.thresholdQty;
    }, false));
    insertCol.appendChild(settingRow("Discount %", state.quote.bulkDiscount.percent, 0, 1, function(v){
      state.quote.bulkDiscount.percent = Math.max(0, v || 0); return state.quote.bulkDiscount.percent;
    }, false));

    var minOrderNote = document.createElement("div");
    minOrderNote.style.fontWeight = "700"; minOrderNote.style.fontSize = "13px"; minOrderNote.style.marginTop = "18px";
    minOrderNote.textContent = "Minimum order value";
    insertCol.appendChild(minOrderNote);
    insertCol.appendChild(settingRow("Minimum total (KSh)", state.quote.minimumOrder, 0, 1, function(v){
      state.quote.minimumOrder = Math.max(0, Math.round(v) || 0); renderOptions(); return state.quote.minimumOrder;
    }, false));

    var bindCol = document.createElement("div");
    bindCol.innerHTML =
      '<div style="font-weight:700; font-size:13.5px; margin-bottom:4px;">Type of binding</div>' +
      '<div style="font-size:11.5px; color:var(--ink-soft); margin-bottom:8px;">Each type\u2019s starting cost per copy, before the quantity discount below.</div>';
    state.quote.bindingOptions.forEach(function(m){ bindCol.appendChild(bindingRow(m)); });
    var addBindingRow = document.createElement("div");
    addBindingRow.className = "add-rate-row";
    addBindingRow.innerHTML = '<input type="text" placeholder="Binding name" data-f="name"><input type="number" placeholder="Starting cost" min="0" data-f="cost"><button class="btn btn-sm" type="button">Add</button>';
    addBindingRow.querySelector("button").addEventListener("click", function(){
      var name = addBindingRow.querySelector('[data-f="name"]').value.trim();
      var cost = Math.max(0, Number(addBindingRow.querySelector('[data-f="cost"]').value) || 0);
      if(!name){ toast("Give the binding type a name first"); return; }
      state.quote.bindingOptions.push({id:"bd_"+Date.now().toString(36), name:name, bindingCost:cost});
      persist(); renderAdminRates(); renderOptions();
    });
    bindCol.appendChild(addBindingRow);

    var discNote = document.createElement("div");
    discNote.style.fontWeight = "700"; discNote.style.fontSize = "13px"; discNote.style.marginTop = "16px";
    discNote.textContent = "Binding quantity discount";
    bindCol.appendChild(discNote);
    bindCol.appendChild(settingRow("Reduce every (qty)", state.quote.bindingDiscount.stepQty, 1, 1, function(v){
      state.quote.bindingDiscount.stepQty = Math.max(1, Math.round(v) || 20); return state.quote.bindingDiscount.stepQty;
    }, false));
    bindCol.appendChild(settingRow("Reduce by (%)", state.quote.bindingDiscount.stepPercent, 0, 1, function(v){
      state.quote.bindingDiscount.stepPercent = Math.max(0, v || 0); return state.quote.bindingDiscount.stepPercent;
    }, false));
    bindCol.appendChild(settingRow("Floor (% of starting cost)", state.quote.bindingDiscount.floorPercent, 0, 1, function(v){
      state.quote.bindingDiscount.floorPercent = Math.max(0, Math.min(100, v || 70)); return state.quote.bindingDiscount.floorPercent;
    }, false));

    var lamHeading = document.createElement("div");
    lamHeading.style.fontWeight = "700"; lamHeading.style.fontSize = "13.5px"; lamHeading.style.margin = "18px 0 8px";
    lamHeading.textContent = "Type of lamination";
    bindCol.appendChild(lamHeading);
    state.quote.laminationOptions.forEach(function(m){ bindCol.appendChild(laminationRow(m)); });
    var addLamRow = document.createElement("div");
    addLamRow.className = "add-rate-row";
    addLamRow.innerHTML = '<input type="text" placeholder="Lamination name" data-f="name"><input type="number" placeholder="Price/copy" min="0" data-f="price"><button class="btn btn-sm" type="button">Add</button>';
    addLamRow.querySelector("button").addEventListener("click", function(){
      var name = addLamRow.querySelector('[data-f="name"]').value.trim();
      var price = Math.max(0, Number(addLamRow.querySelector('[data-f="price"]').value) || 0);
      if(!name){ toast("Give the lamination a name first"); return; }
      state.quote.laminationOptions.push({id:"lm_"+Date.now().toString(36), name:name, price:price});
      persist(); renderAdminRates(); renderOptions();
    });
    bindCol.appendChild(addLamRow);

    cols.appendChild(insertCol);
    cols.appendChild(bindCol);
    panel.appendChild(cols);
    wrap.appendChild(panel);

    var settingsPanel = document.createElement("div");
    settingsPanel.className = "rates-panel";
    settingsPanel.innerHTML =
      '<h4>WhatsApp &amp; M-Pesa (studio only)</h4>' +
      '<div class="sub">Shown to clients on their confirmation screen after they submit a request.</div>';

    var waField = document.createElement("div");
    waField.className = "field"; waField.style.marginBottom = "14px";
    waField.innerHTML = '<label for="settings-wa">Studio WhatsApp number (with country code, digits only)</label>';
    var waInput = document.createElement("input");
    waInput.type = "text"; waInput.id = "settings-wa"; waInput.placeholder = "e.g. 254712345678";
    waInput.value = state.settings.whatsappNumber || "";
    waInput.addEventListener("change", function(){
      state.settings.whatsappNumber = waInput.value.replace(/[^\d]/g, "");
      waInput.value = state.settings.whatsappNumber;
      persist();
      toast("WhatsApp number updated");
    });
    waField.appendChild(waInput);
    settingsPanel.appendChild(waField);

    var mpesaField = document.createElement("div");
    mpesaField.className = "field";
    mpesaField.innerHTML = '<label for="settings-mpesa">M-Pesa payment instructions shown to clients</label>';
    var mpesaInput = document.createElement("textarea");
    mpesaInput.id = "settings-mpesa"; mpesaInput.rows = 3;
    mpesaInput.placeholder = "e.g. Paybill: 400200, Account: Books POD KE\nor Buy Goods Till: 5556677";
    mpesaInput.value = state.settings.mpesaInstructions || "";
    mpesaInput.addEventListener("change", function(){
      state.settings.mpesaInstructions = mpesaInput.value.trim();
      persist();
      toast("M-Pesa instructions updated");
    });
    mpesaField.appendChild(mpesaInput);
    settingsPanel.appendChild(mpesaField);

    var settingsNote = document.createElement("div");
    settingsNote.style.fontSize = "11px"; settingsNote.style.color = "var(--ink-soft)"; settingsNote.style.marginTop = "10px";
    settingsNote.textContent = "Leave WhatsApp blank to hide the WhatsApp button, or M-Pesa blank to hide payment instructions, from clients.";
    settingsPanel.appendChild(settingsNote);

    wrap.appendChild(settingsPanel);

    var backendPanel = document.createElement("div");
    backendPanel.className = "rates-panel";
    backendPanel.innerHTML =
      '<h4>Backend sync (studio only)</h4>' +
      '<div class="sub">' + (API_BASE_URL
        ? "Connected to " + escapeHtml(API_BASE_URL) + ". Enter the same admin key you set as ADMIN_API_KEY on the backend to see and manage every order from any device."
        : "No backend configured (frontend/js/config.js has no API_BASE_URL) — orders stay in this browser only.") +
      '</div>';
    if(API_BASE_URL){
      var keyField = document.createElement("div");
      keyField.className = "field";
      keyField.innerHTML = '<label for="settings-admin-key">Backend admin key</label>';
      var keyInput = document.createElement("input");
      keyInput.type = "password"; keyInput.id = "settings-admin-key";
      keyInput.placeholder = "matches ADMIN_API_KEY on the backend";
      keyInput.value = state.settings.adminApiKey || "";
      keyInput.addEventListener("change", function(){
        state.settings.adminApiKey = keyInput.value.trim();
        persist();
        toast("Admin key saved on this device");
        renderAdminOrders();
      });
      keyField.appendChild(keyInput);
      backendPanel.appendChild(keyField);
    }
    wrap.appendChild(backendPanel);
  }

  /* ---------------- admin auth ---------------- */

  var modalOverlay = document.getElementById("admin-modal");
  var modalBody = document.getElementById("admin-modal-body");
  function closeModal(){ modalOverlay.style.display = "none"; modalBody.innerHTML = ""; }
  document.getElementById("admin-modal-close").addEventListener("click", closeModal);
  modalOverlay.addEventListener("click", function(e){ if(e.target === modalOverlay) closeModal(); });

  function openSetupModal(){
    modalBody.innerHTML =
      '<h3>Set up studio access</h3>' +
      '<p class="note">Create a passcode for editing quote rates and viewing requests.</p>' +
      '<div class="field"><label for="pc1">New passcode</label><input type="password" id="pc1"></div>' +
      '<div class="field"><label for="pc2">Confirm passcode</label><input type="password" id="pc2"></div>' +
      '<p class="error-text" id="setup-error"></p>' +
      '<div class="modal-actions"><button class="btn btn-solid" id="setup-confirm-btn">Create &amp; sign in</button></div>';
    modalOverlay.style.display = "flex";
    document.getElementById("pc1").focus();
    document.getElementById("setup-confirm-btn").addEventListener("click", function(){
      var a = document.getElementById("pc1").value;
      var b = document.getElementById("pc2").value;
      var err = document.getElementById("setup-error");
      if(a.length < 3){ err.textContent = "Use at least 3 characters."; err.classList.add("show"); return; }
      if(a !== b){ err.textContent = "Passcodes don't match."; err.classList.add("show"); return; }
      state.passHash = simpleHash(a); persist();
      isAdmin = true; closeModal(); renderAll();
      toast("Studio mode on — rates are now editable");
    });
  }

  function openSignInModal(){
    modalBody.innerHTML =
      '<h3>Studio sign-in</h3>' +
      '<p class="note">Enter your passcode to edit rates and view quote requests.</p>' +
      '<div class="field"><label for="pc">Passcode</label><input type="password" id="pc"></div>' +
      '<p class="error-text" id="signin-error"></p>' +
      '<div class="modal-actions"><button class="btn btn-ghost btn-sm" id="reset-pass-btn" type="button">Forgot it? Reset</button><button class="btn btn-solid" id="signin-confirm-btn">Sign in</button></div>';
    modalOverlay.style.display = "flex";
    var input = document.getElementById("pc"); input.focus();
    function tryLogin(){
      var v = input.value; var err = document.getElementById("signin-error");
      if(simpleHash(v) === state.passHash){ isAdmin = true; closeModal(); renderAll(); toast("Studio mode on"); }
      else{ err.textContent = "That passcode isn't right."; err.classList.add("show"); }
    }
    input.addEventListener("keydown", function(e){ if(e.key === "Enter") tryLogin(); });
    document.getElementById("signin-confirm-btn").addEventListener("click", tryLogin);
    document.getElementById("reset-pass-btn").addEventListener("click", function(){
      if(confirm("Reset the studio passcode? You'll set a new one now.")){ state.passHash = null; persist(); openSetupModal(); }
    });
  }

  document.getElementById("admin-toggle-btn").addEventListener("click", function(){
    if(isAdmin){ isAdmin = false; renderAll(); toast("Back to client view"); return; }
    if(!state.passHash){ openSetupModal(); } else { openSignInModal(); }
  });

  function renderAll(){
    renderOptions();
    renderOrderPanel();
    renderAdminOrders();
    renderAdminRates();
    document.getElementById("mode-pill").textContent = isAdmin ? "Studio mode" : "Client view";
    document.getElementById("mode-pill").className = "pill" + (isAdmin ? " admin" : "");
    document.getElementById("admin-toggle-btn").textContent = isAdmin ? "Exit studio mode" : "Studio sign-in";
    document.getElementById("admin-orders-section").style.display = isAdmin ? "" : "none";
  }

  renderAll();
})();
