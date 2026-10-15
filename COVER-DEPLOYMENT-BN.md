# Uttara Shoe cover-password preview (Bangla)

এই পরিবর্তনটি কেবল `feature/secure-cover-password` শাখায়। `main` বা Production-এ merge করা হয়নি।

## Vercel Preview-এর জন্য Environment Variables

Vercel Project → Settings → Environment Variables-এ Preview environment-এর জন্য দুটি মান যোগ করতে হবে:

- `UTTARA_COVER_PASSWORD`: সবার জন্য একই কভার পাসওয়ার্ড; শক্তিশালী ও আলাদা পাসওয়ার্ড ব্যবহার করুন।
- `UTTARA_COVER_SECRET`: কমপক্ষে 32 অক্ষরের একটি গোপন random secret। এটি কভার পাসওয়ার্ডের থেকে আলাদা রাখুন।

এই মানগুলো HTML, JavaScript, GitHub বা Supabase browser config-এ রাখবেন না। মান যোগ করার পর Preview redeploy করুন।

## কীভাবে কাজ করবে

1. `/` এবং `/index.html` সার্ভার-সাইড handler দিয়ে যাচাই হবে।
2. সঠিক কভার পাসওয়ার্ডের পর HttpOnly, Secure, SameSite=Strict cookie দেওয়া হবে।
3. অ্যাপ খোলার পরও প্রত্যেক ব্যক্তিকে নিজের Supabase Auth account দিয়ে লগইন করতে হবে।
4. 30 মিনিট নিষ্ক্রিয় থাকলে কভার পুনরায় দেখাবে। Supabase Auth, RLS, সদস্য অনুমতি ও MD approval-এর নীতি পরিবর্তন করা হয়নি।
5. এই কভারটি অতিরিক্ত প্রবেশ-প্রাচীর; এটি Supabase RLS-এর বিকল্প নয়।

## Preview পরীক্ষার তালিকা

- ভুল পাসওয়ার্ড প্রত্যাখ্যান হয়।
- সঠিক পাসওয়ার্ডে `/` খোলে।
- `/index.html` সরাসরি খুললেও কভার যাচাই এড়ানো যায় না।
- কভার cookie ছাড়া protected page-এ গেলে কভারে ফেরত যায়।
- কভার পার হওয়ার পর ব্যক্তিগত Supabase login এখনও প্রয়োজন।
- MD approval, RLS-নিয়ন্ত্রিত পড়া/লেখা এবং বিদ্যমান ডেটা অপরিবর্তিত থাকে।
- 30 মিনিট নিষ্ক্রিয়তার পরে কভার ফেরে; সক্রিয় ব্যবহারে session নবায়ন হয়।
- মোবাইল ও ডেস্কটপে ভুল/সঠিক পাসওয়ার্ড পরীক্ষা করুন।

## গুরুত্বপূর্ণ সীমাবদ্ধতা

API function-এর in-memory failed-attempt counter একাধিক serverless instance-এ স্থায়ী rate limit নয়; production-এ শক্তিশালী rate limiting চাইলে Redis/Vercel KV/Edge Config-এর মতো shared store যুক্ত করতে হবে। Preview-তে বাস্তব browser test ও Vercel deployment check না হওয়া পর্যন্ত এটিকে production-ready বলা যাবে না।
