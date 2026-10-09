/* Uttara Shoe — MD approval gate. Sensitive manager actions require a fresh server-side MD approval. */
(() => {
  const client = () => window.uttaraSupabase;
  let approvalPromise = null;

  const isManager = async () => {
    const c = client();
    if (!c) return false;
    const { data: { user } = {} } = await c.auth.getUser();
    if (!user) return false;
    const { data, error } = await c.from('app_members').select('role,active').eq('user_id', user.id).maybeSingle();
    return !error && data?.active === true && data?.role === 'manager';
  };

  const configured = async () => {
    const { data, error } = await client().rpc('uttara_md_pin_configured');
    if (error) throw error;
    return data === true;
  };

  const ask = (message) => {
    const value = window.prompt(message);
    return value === null ? null : value.trim();
  };

  const approve = async action => {
    if (!(await isManager())) return true;
    if (approvalPromise) return approvalPromise;

    approvalPromise = (async () => {
      const c = client();
      if (!c) throw new Error('Supabase সংযোগ পাওয়া যায়নি।');
      let hasPin = await configured();

      if (!hasPin) {
        const first = ask('নিরাপত্তা চালু করতে MD Approval PIN সেট করুন।\nকমপক্ষে ৬ অক্ষর/সংখ্যা দিন:');
        if (first === null) throw new Error('MD অনুমোদন বাতিল করা হয়েছে।');
        const second = ask('MD Approval PIN আবার লিখুন:');
        if (second === null || first !== second) throw new Error('দুইবারের PIN একই নয়।');
        if (first.length < 6) throw new Error('PIN কমপক্ষে ৬ অক্ষরের হতে হবে।');

        const { error } = await c.rpc('uttara_set_md_pin', { p_pin: first });
        if (error) throw error;
        hasPin = true;
      }

      const pin = ask('এই সংবেদনশীল কাজের অনুমোদনের জন্য MD Approval PIN দিন:');
      if (pin === null) throw new Error('MD অনুমোদন বাতিল করা হয়েছে।');

      const { error } = await c.rpc('uttara_approve_md', { p_pin: pin, p_action: action || 'sensitive_change' });
      if (error) throw error;
      return true;
    })().finally(() => { approvalPromise = null; });

    return approvalPromise;
  };

  window.uttaraRequireMdApproval = approve;

  const wrap = (name, action, original) => {
    if (typeof original !== 'function') return;
    window[name] = async function (...args) {
      try {
        await approve(action);
        return original.apply(this, args);
      } catch (error) {
        const msg = String(error?.message || error || 'MD অনুমোদন পাওয়া যায়নি.');
        if (typeof window.toast === 'function') window.toast(msg);
        else window.alert(msg);
        return undefined;
      }
    };
  });

  const originalSave = window.save;
  wrap('save', 'সাধারণ তথ্য সংযোজন/বিয়োজন/পরিবর্তন', originalSave);

  const originalSale = window.saveSale;
  wrap('saveSale', 'বিক্রয়/চালান পরিবর্তন', originalSale);


  const originalMember = window.saveCloudMember;
  wrap('saveCloudMember', 'এসআর/স্টাফ সদস্য ও অনুমতি পরিবর্তন', originalMember);
})();
