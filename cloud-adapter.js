/* Uttara Shoes Supabase browser adapter. Database authorization is enforced by RLS and RPCs. */
(() => {
  const config = window.UTTARA_SUPABASE_CONFIG;
  const collections = ['materials','products','dealers','batches','sales','expenses','activityLogs','supplierPurchases','purchaseOrders','employees','employeePayments','attendance','staffTargets','workTasks','materialUsages','srVisits','doOrders'];
  const extraCollections = ['srVisits','doOrders'];
  const key = (collection, id) => `${collection}:${String(id)}`;
  let client = null;
  let signedUser = null;
  let member = null;
  let memberRows = [];
  let cloudActive = false;
  let baseline = null;
  let metadata = new Map();
  let writeQueue = Promise.resolve();
  let refreshing = false;

  if (typeof crypto !== 'undefined' && crypto.randomUUID) window.id = () => crypto.randomUUID();

  const clone = value => JSON.parse(JSON.stringify(value));
  const stateSnapshot = () => Object.fromEntries(collections.map(name => [name, clone(db[name] || [])]));
  const snapshotText = value => JSON.stringify(value);
  const memberIsManager = () => member?.role === 'manager' && member?.active === true;
  const setStatus = message => {
    const node = document.querySelector('#cloudMessage');
    if (node) node.textContent = message || '';
  };
  const showError = message => {
    const node = document.querySelector('#cloudMessage');
    if (node) node.textContent = message || 'কাজটি সম্পন্ন হয়নি। আবার চেষ্টা করুন।';
    else if (typeof toast === 'function') toast(message || 'ক্লাউডে সংরক্ষণ হয়নি');
  };
  const normalizeError = error => String(error?.message || error || 'অজানা সমস্যা').replace(/https?:\/\/\S+/g, '');
  const setHeader = () => {
    const box = document.querySelector('.userbox');
    if (!box) return;
    if (!document.querySelector('#refreshCloudBtn')) {
      const button = document.createElement('button');
      button.id = 'refreshCloudBtn';
      button.className = 'btn secondary';
      button.textContent = 'তথ্য হালনাগাদ';
      button.onclick = () => refreshSharedData(true).catch(error => showError(normalizeError(error)));
      box.insertBefore(button, document.querySelector('#exportBtn'));
    }
  };
  const buildAuth = message => {
    const root = document.querySelector('#modalroot');
    if (!root) return;
    root.innerHTML = `<div class="overlay"><div class="modal" style="width:min(440px,100%);padding:28px;border-radius:18px">
      <div style="text-align:center;margin-bottom:24px">
        <div style="font-size:30px;font-weight:800;line-height:1.2;margin-bottom:8px">উত্তরা সুজ</div>
        <div style="font-size:19px;font-weight:700;margin-bottom:6px">উত্তরা সুজ — লগইন</div>
        <div class="small">উৎপাদন ও বিক্রয় ব্যবস্থাপনা সিস্টেম</div>
      </div>
      <p id="cloudMessage" class="${message ? 'danger' : 'small'}" style="min-height:20px;margin-bottom:14px">${esc(message || '')}</p>
      <form onsubmit="cloudSignIn(event)">
        <label style="display:block;font-weight:600;margin-bottom:6px">লগইনের ধরন
          <select id="cloudRole" style="width:100%;box-sizing:border-box;margin:5px 0 14px">
            <option value="manager">ব্যবস্থাপনা পরিচালক</option>
            <option value="sr">এসআর</option>
            <option value="staff">কর্মকর্তা / স্টাফ</option>
          </select>
        </label>
        <label style="display:block;font-weight:600;margin-bottom:6px">ইমেইল
          <input id="cloudEmail" type="email" autocomplete="username" value="uttarashoe8@gmail.com" placeholder="ইমেইল লিখুন" required style="width:100%;box-sizing:border-box;margin:5px 0 14px">
        </label>
        <label style="display:block;font-weight:600;margin-bottom:6px">পাসওয়ার্ড
          <input id="cloudPassword" type="password" autocomplete="current-password" minlength="8" placeholder="পাসওয়ার্ড লিখুন" required style="width:100%;box-sizing:border-box;margin:5px 0 8px">
        </label>
        <button class="btn" type="submit" style="width:100%;margin-top:12px;min-height:46px;font-size:16px;font-weight:700">ব্যবস্থাপনা পরিচালক লগইন</button>
      </form>
      <button type="button" class="btn secondary" onclick="cloudSignUpForm()" style="width:100%;margin-top:8px">নতুন এসআর / স্টাফ অ্যাকাউন্টের আবেদন</button>
      <div class="small" style="text-align:center;margin-top:18px;line-height:1.6">এসআর ও স্টাফ অ্যাকাউন্ট ব্যবস্থাপনা পরিচালক অনুমোদন না দেওয়া পর্যন্ত সক্রিয় হবে না।</div>
    </div></div>`;
  };

  window.showAuth = buildAuth;
  window.cloudSignIn = async event => {
    event.preventDefault();
    if (!client) return showError('Supabase সংযোগ শুরু হয়নি; পেজটি আবার খুলুন।');
    const emailNode = document.querySelector('#cloudEmail');
    const passwordNode = document.querySelector('#cloudPassword');
    if (!emailNode || !passwordNode) return showError('লগইন ফর্ম পাওয়া যায়নি। পেজটি আবার খুলুন।');
    const email = emailNode.value.trim().toLowerCase();
    const password = passwordNode.value;
    const expectedRole = document.querySelector('#cloudRole')?.value || 'manager';
    if (!email) return showError('ইমেইল লিখুন।');
    if (!password) return showError('পাসওয়ার্ড লিখুন।');
    setStatus('লগইন হচ্ছে…');
    const { data, error } = await client.auth.signInWithPassword({ email, password });
    if (error) return showError('ইমেইল অথবা পাসওয়ার্ড সঠিক নয়।');
    if (!data?.user) return showError('লগইন করা যায়নি। আবার চেষ্টা করুন।');
    const profile = await verifyMember(data.user.id);
    if (!profile || !profile.active) {
      await client.auth.signOut();
      return buildAuth('অ্যাকাউন্টটি এখনো পরিচালক অনুমোদন করেননি।');
    }
    if (profile.role !== expectedRole) {
      await client.auth.signOut();
      return buildAuth('এই অ্যাকাউন্টটি নির্বাচিত লগইন ধরনের নয়। সঠিক লগইন ধরন নির্বাচন করুন।');
    }
    try {
      await enterApp(data.user);
    } catch (problem) {
      await client.auth.signOut();
      signedUser = null;
      member = null;
      cloudActive = false;
      buildAuth(normalizeError(problem));
    }
  };


  const readRecords = async () => {
    const all = [];
    for (let offset = 0; ; offset += 1000) {
      const { data, error } = await client.from('app_records').select('*').order('collection').range(offset, offset + 999);
      if (error) throw error;
      all.push(...(data || []));
      if (!data || data.length < 1000) break;
    }
    if (!memberIsManager() && (member?.permissions || []).some(permission => ['sales','reports'].includes(permission))) {
      const { data, error } = await client.rpc('uttara_list_sales_for_member');
      if (error) throw error;
      for (const row of data || []) all.push({collection:'sales', ...row, payload:row.payload, created_by:row.owner_id, created_at:null, updated_at:null});
    }
    if (!memberIsManager() && (member?.permissions || []).some(permission => ['sales','products'].includes(permission))) {
      const { data, error } = await client.rpc('uttara_list_products_for_sale');
      if (error) throw error;
      for (const payload of data || []) all.push({collection:'products', record_id:String(payload.id), payload, owner_id:null, created_by:null, created_at:null, updated_at:null});
    }
    return all;
  };
  const readMembers = async () => {
    const { data, error } = await client.from('app_members').select('user_id,display_name,email,role,permissions,max_discount,active').order('display_name');
    if (error) throw error;
    return data || [];
  };
  const applyCloudData = (records, profiles) => {
    const next = clone(defaults);
    for (const name of extraCollections) next[name] = [];
    const newMeta = new Map();
    for (const row of records) {
      if (!Array.isArray(next[row.collection])) continue;
      next[row.collection].push(row.payload);
      newMeta.set(key(row.collection, row.record_id), {
        ownerId: row.owner_id,
        createdBy: row.created_by,
        createdAt: row.created_at,
        updatedAt: row.updated_at
      });
    }
    const visibleProfiles = memberIsManager() ? profiles : [member];
    next.users = visibleProfiles.map(profile => profile.display_name);
    next.access = {};
    for (const profile of visibleProfiles) {
      next.access[profile.display_name] = {
        approved: profile.active,
        manager: profile.role === 'manager',
        permissions: profile.role === 'manager' ? [] : (profile.permissions || []),
        maxDiscount: Number(profile.max_discount || 0)
      };
    }
    next.accessRequests = [];
    db = next;
    metadata = newMeta;
    memberRows = profiles;
    baseline = stateSnapshot();
    if (document.querySelector('#printBrandImg') && document.querySelector('.brand-mark')) {
      document.querySelector('#printBrandImg').src = document.querySelector('.brand-mark').src;
    }
  };
  const loadMembers = async () => {
    if (memberIsManager()) return readMembers();
    return [member];
  };
  const verifyMember = async userId => {
    const { data, error } = await client.from('app_members').select('*').eq('user_id', userId).maybeSingle();
    if (error) throw error;
    return data;
  };
  
  window.cloudSignUpForm = function () {
    const root = document.querySelector('#modalroot');
    if (!root) return;
    root.innerHTML = `<div class="overlay"><div class="modal" style="width:min(440px,100%);padding:28px;border-radius:18px">
      <div style="text-align:center;margin-bottom:20px">
        <div style="font-size:24px;font-weight:800">নতুন অ্যাকাউন্টের আবেদন</div>
        <div class="small">পরিচালক অনুমোদনের পর অ্যাকাউন্ট চালু হবে</div>
      </div>
      <p id="cloudMessage" class="small" style="min-height:20px;margin-bottom:14px"></p>
      <form onsubmit="cloudSignUp(event)">
        <label style="display:block;font-weight:600">নাম
          <input id="signupName" required style="width:100%;box-sizing:border-box;margin:5px 0 12px">
        </label>
        <label style="display:block;font-weight:600">অ্যাকাউন্টের ধরন
          <select id="signupRole" style="width:100%;box-sizing:border-box;margin:5px 0 12px">
            <option value="sr">এসআর</option>
            <option value="staff">কর্মকর্তা / স্টাফ</option>
          </select>
        </label>
        <label style="display:block;font-weight:600">ইমেইল
          <input id="signupEmail" type="email" required style="width:100%;box-sizing:border-box;margin:5px 0 12px">
        </label>
        <label style="display:block;font-weight:600">পাসওয়ার্ড
          <input id="signupPassword" type="password" minlength="8" required style="width:100%;box-sizing:border-box;margin:5px 0 12px">
        </label>
        <button class="btn" type="submit" style="width:100%;min-height:44px">আবেদন জমা দিন</button>
      </form>
      <button type="button" class="btn secondary" onclick="buildAuth()" style="width:100%;margin-top:8px">লগইনে ফিরে যান</button>
    </div></div>`;
  };

  window.cloudSignUp = async function (event) {
    event.preventDefault();
    if (!client) return showError('Supabase সংযোগ শুরু হয়নি; পেজটি আবার খুলুন।');
    const displayName = document.querySelector('#signupName')?.value.trim();
    const email = document.querySelector('#signupEmail')?.value.trim().toLowerCase();
    const password = document.querySelector('#signupPassword')?.value;
    const role = document.querySelector('#signupRole')?.value || 'staff';
    if (!displayName || !email || !password) return showError('সব তথ্য পূরণ করুন।');
    setStatus('অ্যাকাউন্ট তৈরি হচ্ছে…');
    const { data, error } = await client.auth.signUp({
      email, password,
      options: { data: { display_name: displayName, requested_role: role } }
    });
    if (error) return showError(normalizeError(error));
    if (!data.user) return showError('অ্যাকাউন্ট তৈরি করা যায়নি।');
    buildAuth('আবেদন জমা হয়েছে। পরিচালক অনুমোদন দেওয়ার পর নির্বাচিত লগইন ধরনের মাধ্যমে প্রবেশ করতে পারবেন।');
  };

const enterApp = async authUser => {
    if (refreshing) return;
    refreshing = true;
    signedUser = authUser;
    try {
      const profile = await verifyMember(authUser.id);
      if (!profile || !profile.active) {
        await client.auth.signOut();
        signedUser = null;
        member = null;
        cloudActive = false;
        buildAuth('অ্যাকাউন্ট তৈরি হয়েছে, তবে পরিচালক অনুমোদন না দেওয়া পর্যন্ত প্রবেশ করা যাবে না।');
        return;
      }
      member = profile;
      const [profiles, records] = await Promise.all([loadMembers(), readRecords()]);
      applyCloudData(records, profiles);
      currentUser = member.display_name;
      page = allowedPages()[0] || 'home';
      cloudActive = true;
      document.querySelector('#modalroot').innerHTML = '';
      setHeader();
      if (typeof render === 'function') render();
    } finally { refreshing = false; }
  };

  const canEditPage = pageName => memberIsManager() || (member?.permissions || []).includes(pageName);
  const collectionPage = collection => ({workTasks:'tasks', srVisits:'srDuties', doOrders:'doPad'}[collection] || collection);
  const persistSnapshot = async snap => {
    if (!cloudActive || !baseline) return;
    for (const collection of collections) {
      const before = baseline[collection] || [];
      const after = snap[collection] || [];
      const beforeMap = new Map(before.filter(row => row?.id != null).map(row => [String(row.id), row]));
      const afterMap = new Map(after.filter(row => row?.id != null).map(row => [String(row.id), row]));
      const removed = [...beforeMap.keys()].filter(id => !afterMap.has(id));
      const changed = [...afterMap.entries()].filter(([id, row]) => !beforeMap.has(id) || snapshotText(beforeMap.get(id)) !== snapshotText(row));
      if (!removed.length && !changed.length) continue;
      if (!memberIsManager() && collection === 'activityLogs') {
        const newLogs = changed.filter(([id]) => !beforeMap.has(id)).map(([, payload]) => ({collection, record_id: String(payload.id), payload, owner_id: signedUser.id, created_by: signedUser.id}));
        if (newLogs.length) {
          const { error } = await client.from('app_records').insert(newLogs);
          if (error) throw error;
        }
        continue;
      }
      if (!memberIsManager() && (removed.length || !canEditPage(collectionPage(collection)))) {
        throw new Error('এই তথ্য পরিবর্তনের অনুমতি আপনার অ্যাকাউন্টে নেই।');
      }
      for (const id of removed) {
        const meta = metadata.get(key(collection, id));
        let request = client.from('app_records').delete().eq('collection', collection).eq('record_id', id);
        if (meta?.updatedAt) request = request.eq('updated_at', meta.updatedAt);
        const { data, error } = await request.select('record_id');
        if (error) throw error;
        if (!data?.length) throw new Error('রেকর্ডটি অন্য কেউ বদলেছেন; তথ্য হালনাগাদ করে আবার চেষ্টা করুন।');
        metadata.delete(key(collection, id));
      }
      const created = changed.filter(([id]) => !metadata.has(key(collection, id)));
      for (let offset = 0; offset < created.length; offset += 200) {
        const rows = created.slice(offset, offset + 200).map(([id, payload]) => {
          const meta = metadata.get(key(collection, id));
          return {collection, record_id:id, payload, owner_id:meta?.ownerId || signedUser.id, created_by:meta?.createdBy || signedUser.id};
        });
        const { data, error } = await client.from('app_records').insert(rows).select('collection,record_id,owner_id,created_by,created_at,updated_at');
        if (error) throw error;
        for (const row of data || []) metadata.set(key(row.collection,row.record_id), {
          ownerId:row.owner_id, createdBy:row.created_by, createdAt:row.created_at, updatedAt:row.updated_at
        });
      }
      const createdIds = new Set(created.map(([id]) => id));
      for (const [id, payload] of changed) {
        const k = key(collection, id);
        const meta = metadata.get(k);
        if (!meta) continue;
        if (createdIds.has(id)) continue;
        const row = {
          collection,
          record_id: id,
          payload,
          owner_id: meta?.ownerId || signedUser.id,
          created_by: meta?.createdBy || signedUser.id
        };
        if (!meta) {
          const { data, error } = await client.from('app_records').insert(row).select('owner_id,created_by,created_at,updated_at').single();
          if (error) throw error;
          metadata.set(k, { ownerId:data.owner_id, createdBy:data.created_by, createdAt:data.created_at, updatedAt:data.updated_at });
        } else {
          const { data, error } = await client.from('app_records').update({payload, updated_at:new Date().toISOString()})
            .eq('collection', collection).eq('record_id', id).eq('updated_at', meta.updatedAt)
            .select('owner_id,created_by,created_at,updated_at').maybeSingle();
          if (error) throw error;
          if (!data) throw new Error('রেকর্ডটি অন্য কেউ বদলেছেন; তথ্য হালনাগাদ করে আবার চেষ্টা করুন।');
          metadata.set(k, { ownerId:data.owner_id, createdBy:data.created_by, createdAt:data.created_at, updatedAt:data.updated_at });
        }
      }
    }
    baseline = snap;
  };
  window.save = function () {
    if (typeof render === 'function') render();
    if (!cloudActive) return;
    const snap = stateSnapshot();
    writeQueue = writeQueue.catch(() => {}).then(() => persistSnapshot(snap)).catch(error => {
      showError(`ক্লাউডে সংরক্ষণ হয়নি: ${normalizeError(error)}`);
    });
  };

  window.saveSale = async function () {
    if (!cloudActive || (!memberIsManager() && !canEditPage('sales'))) return showError('বিক্রির অনুমতি আপনার অ্যাকাউন্টে নেই।');
    const kind = document.querySelector('#skind').value;
    const customer = kind === 'নিজস্ব দোকান' ? val('shopcustomer') : (val('scustomer') || 'অন্যান্য ক্রেতা');
    const lines = [...document.querySelectorAll('#saleitems .lineitem')].map(row => ({
      pid: row.querySelector('.itemproduct').value,
      qty: Number(row.querySelector('.itemqty').value),
      price: Number(row.querySelector('.itemprice').value)
    }));
    if (!lines.length || lines.some(line => !line.pid || line.qty < 1 || !Number.isFinite(line.price))) return showError('পণ্য, পরিমাণ ও দাম যাচাই করুন।');
    const subtotal = lines.reduce((sum,line) => sum + line.qty * line.price, 0);
    const discount = num('sdiscount');
    const total = Math.max(0, subtotal - discount);
    const paid = Math.min(total, num('spaid'));
    const id = crypto.randomUUID();
    const method = val('spaymethod');
    const sale = {
      id, no:`US-${new Date().getFullYear()}-${id.slice(0,8).toUpperCase()}`,
      date:val('sdate') || date(), customer, kind, lines, subtotal, discount, total, paid, due:total-paid,
      paymentMethod:paid ? method : '', payments:paid ? [{reference:val('spayref') || ''}] : []
    };
    setStatus('বিক্রি ও মজুত একসঙ্গে সংরক্ষণ হচ্ছে…');
    const { data, error } = await client.rpc('uttara_create_sale', {p_sale:sale});
    if (error) return showError(normalizeError(error));
    closeModal();
    const refreshError = await refreshSharedData(false).then(() => null).catch(problem => problem);
    if (refreshError && cloudActive) {
      db.sales.push(data);
      if (baseline) baseline.sales = clone(db.sales);
      metadata.set(key('sales',data.id), {ownerId:signedUser.id,createdBy:signedUser.id,createdAt:null,updatedAt:null});
    }
    logActivity('বিক্রির চালান তৈরি', `${data.no} · ${data.customer} · ${money(data.total)}`);
    save();
    toast(refreshError ? 'বিক্রি সংরক্ষিত; তথ্য হালনাগাদে আবার ইন্টারনেট প্রয়োজন' : 'বিক্রি ও মজুত একসঙ্গে সংরক্ষিত হয়েছে');
  };
  window.selectedSalePrice = function (option) {
    if (document.querySelector('#skind').value === 'নিজস্ব দোক') return option.dataset.retail || 0;
    const customer = document.querySelector('#scustomer').value;
    const dealer = db.dealers.find(row => row.name === customer);
    return dealer?.type === 'পাইকার' ? (option.dataset.wholesale || option.dataset.dealer || 0) : (option.dataset.dealer || 0);
  };
  window.openSale = function (dealerId = '') {
    if (!canAccess('sales')) return toast('বিক্রি অপশনের অনুমতি পরিচালক দেননি');
    const dealerOptions = db.dealers.map(dealer => `<option value="${esc(dealer.name)}" ${dealer.id === dealerId ? 'selected' : ''}>${esc(dealer.name)}</option>`).join('');
    modal('নতুন বিক্রি', `<div class="formgrid"><label>বিক্রির ধরন<select id="skind" onchange="toggleCustomer()"><option>ডিলার</option><option>নিজস্ব দোকান</option></select></label><label>তারিখ<input id="sdate" type="date" value="${date()}"></label><label class="wide" id="customerwrap">ডিলার নির্বাচন<select id="scustomer" onchange="syncSalePrices()"><option value="">নতুন / অন্যান্য ক্রেতা</option>${dealerOptions}</select></label><label class="wide hidden" id="shopwrap">ক্রেতা / কাউন্টার নাম<input id="shopcustomer" value="দোকান বিক্রি"></label></div><div style="margin-top:16px;font-weight:700">পণ্য যোগ করুন</div><div id="saleitems">${saleItem()}</div><button type="button" class="btn secondary" onclick="addSaleItem()">＋ আরেকটি পণ্য</button><div class="formgrid" style="margin-top:14px"><label>ছাড় (টাকা)<input id="sdiscount" type="number" min="0" value="0" oninput="calcTotal()"></label><label>জমা (টাকা)<input id="spaid" type="number" min="0" value="0" oninput="calcTotal()"></label><label>জমার মাধ্যম<select id="spaymethod">${paymentMethodOptions()}</select></label><label>ট্রানজ্যাকশন / রেফারেন্স নম্বর (ঐচ্ছিক)<input id="spayref"></label></div><div class="row"><b>মোট</b><b id="saletotal">৳ ০</b></div>`, 'saveSale()');
  };
  window.saveReceivedPayment = async function (saleId) {
    const amount = num('receiveAmount');
    if (!cloudActive || amount <= 0) return showError('জমার পরিমাণ যাচাই করুন।');
    const localSale = db.sales.find(item => String(item.id) === String(saleId));
    const saleMeta = metadata.get(key('sales', saleId));
    if (!localSale || (!memberIsManager() && saleMeta?.ownerId !== signedUser.id)) return showError('অন্য সদস্যের বিক্রিতে জমা নথিভুক্ত করার অনুমতি নেই।');
    const method = val('receiveMethod');
    const { data, error } = await client.rpc('uttara_receive_sale_payment', {
      p_sale_id:String(saleId), p_amount:amount, p_method:method, p_reference:val('receiveRef') || ''
    });
    if (error) return showError(normalizeError(error));
    closeModal();
    const refreshError = await refreshSharedData(false).then(() => null).catch(problem => problem);
    if (refreshError && cloudActive) {
      const index = db.sales.findIndex(item => String(item.id) === String(saleId));
      if (index >= 0) db.sales[index] = data;
      if (baseline) baseline.sales = clone(db.sales);
    }
    logActivity('পেমেন্ট গ্রহণ', `${data.no} · ${money(amount)} · ${method}`);
    save();
    toast('পেমেন্ট নথিভুক্ত হয়েছে');
  };
  const originalReceivePayment = window.receivePayment;
  window.receivePayment = function (saleId) {
    const meta = metadata.get(key('sales', saleId));
    if (!memberIsManager() && meta?.ownerId !== signedUser?.id) return toast('শুধু নিজের বিক্রির পেমেন্ট নিতে পারবেন');
    return originalReceivePayment(saleId);
  };

  window.userAdminPage = async function (el) {
    if (!memberIsManager()) { el.innerHTML = title('অনুমতি প্রয়োজন','এই পৃষ্ঠা শুধু পরিচালকের জন্য।'); return; }
    const { data, error } = await client.from('app_members').select('*').order('display_name');
    if (error) { el.innerHTML = title('সদস্য ব্যবস্থাপনা','তথ্য আনা যায়নি') + `<div class="notice">${esc(normalizeError(error))}</div>`; return; }
    const pages = Object.entries(pageNames()).filter(([key]) => !['home','userAdmin'].includes(key));
    const rows = (data || []).map(profile => `<tr><td><b>${esc(profile.display_name)}</b><div class="small">${esc(profile.email || '')}</div></td>
      <td><select class="member-role" data-user="${esc(profile.user_id)}"><option value="staff" ${profile.role==='staff'?'selected':''}>কর্মকর্তা / স্টাফ</option><option value="sr" ${profile.role==='sr'?'selected':''}>এসআর</option><option value="manager" ${profile.role==='manager'?'selected':''}>ম্যানেজার</option></select></td>
      <td><label><input type="checkbox" class="member-active" data-user="${esc(profile.user_id)}" ${profile.active?'checked':''}> সক্রিয়</label>
      <div class="small">সর্বোচ্চ ছাড় (%) <input class="member-discount" data-user="${esc(profile.user_id)}" type="number" min="0" max="100" value="${Number(profile.max_discount)||0}" style="width:75px;padding:5px"></div></td>
      <td><div style="min-width:230px;max-width:440px">${pages.map(([key,label])=>`<label style="display:inline-flex;align-items:center;gap:4px;margin:3px 8px 3px 0"><input type="checkbox" class="member-permission" data-user="${esc(profile.user_id)}" value="${esc(key)}" ${(profile.permissions||[]).includes(key)?'checked':''}>${esc(label)}</label>`).join('')}</div></td>
      <td><button class="btn" onclick="saveCloudMember('${esc(profile.user_id)}')">সংরক্ষণ</button></td></tr>`).join('');
    el.innerHTML = title('এসআর / কর্মকর্তা / স্টাফ অনুমোদন','নতুন অ্যাকাউন্ট আবেদন এখানে সক্রিয় করুন, ভূমিকা দিন এবং প্রয়োজনীয় পৃষ্ঠা অনুমতি নির্বাচন করুন।') + table(['সদস্য','ভূমিকা','অ্যাকাউন্ট','পৃষ্ঠা অনুমতি',''],rows,'এখনও কোনো সদস্য নেই');
  };
  window.saveCloudMember = async userId => {
    if (!memberIsManager()) return showError('শুধু ম্যানেজার সদস্যের অনুমতি বদলাতে পারবেন।');
    const role = document.querySelector(`.member-role[data-user="${CSS.escape(userId)}"]`).value;
    const active = document.querySelector(`.member-active[data-user="${CSS.escape(userId)}"]`).checked;
    const maxDiscount = Number(document.querySelector(`.member-discount[data-user="${CSS.escape(userId)}"]`).value || 0);
    const permissions = [...document.querySelectorAll(`.member-permission[data-user="${CSS.escape(userId)}"]:checked`)].map(input => input.value);
    const { error } = await client.from('app_members').update({role,active,max_discount:maxDiscount,permissions}).eq('user_id',userId);
    if (error) return showError(normalizeError(error));
    toast('সদস্যের অনুমতি সংরক্ষিত হয়েছে');
    await refreshSharedData(true);
  };

  window.logout = async function () {
    try {
      cloudActive = false;
      signedUser = null;
      member = null;
      baseline = null;
      memberRows = [];
      if (client) await client.auth.signOut();
    } catch (error) {
      console.warn('Logout error:', normalizeError(error));
    } finally {
      currentUser = '';
      page = 'home';
      buildAuth('আপনি সফলভাবে লগআউট করেছেন।');
    }
  };

  async function refreshSharedData(shouldRender = true) {
    if (!cloudActive || !signedUser) return;
    const profile = await verifyMember(signedUser.id);
    if (!profile || !profile.active) return window.logout();
    member = profile;
    const profiles = await loadMembers();
    const records = await readRecords();
    applyCloudData(records, profiles);
    if (shouldRender && typeof render === 'function') render();
  }
  window.refreshCloudData = () => refreshSharedData(true).catch(error => showError(normalizeError(error)));

  async function start() {
    buildAuth();
    if (!config?.url || !config?.publishableKey || !window.supabase?.createClient) {
      return showError('Supabase সংযোগের সেটিংস পাওয়া যায়নি।');
    }
    client = window.supabase.createClient(config.url, config.publishableKey);
    window.uttaraSupabase = client;
    const { data, error } = await client.auth.getSession();
    if (error) return showError(normalizeError(error));
    if (data.session?.user) {
      try { await enterApp(data.session.user); } catch (problem) { showError(normalizeError(problem)); }
    }
    setInterval(async () => {
      if (!cloudActive || refreshing || !baseline || (document.querySelector('#modalroot')?.children.length || 0) > 0) return;
      if (snapshotText(stateSnapshot()) !== snapshotText(baseline)) return;
      try { await refreshSharedData(true); } catch (problem) { showError(normalizeError(problem)); }
    }, 20000);
  }

  window.showAuth = buildAuth;
  start().catch(error => showError(normalizeError(error)));
})();
