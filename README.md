# K.S OPTICALS — Deploy Guide (GitHub + Vercel + Supabase)

Ye project **Vite + React + Supabase** pe bana hai. Aapke paas already GitHub, Vercel
aur Supabase accounts hain — bas neeche diye steps follow karo.

> ⚠️ **Important:** Aapki dusri website jis Supabase project pe chal rahi hai, usi mein
> ye customer data mat daalna. Isके liye ek **naya, alag Supabase project** banayein
> (Step 1 mein) — taaki K.S OPTICALS ka data aapki dusri site se completely separate rahe.

---

## Step 1 — Naya Supabase Project banao

1. https://supabase.com/dashboard pe jao (apne existing account se hi login)
2. **New project** → naam do jaise `ks-opticals` → ek database password set karo (save kar lo)
   → apne se paas ka region choose karo (jaise Mumbai/Singapore)
3. Project ban jaane tak 1-2 min wait karo

### Database schema banao
1. Left sidebar mein **SQL Editor** kholo
2. **New query** → is project ki `schema.sql` file ka **pura content copy-paste** karo
3. **Run** dabao — ye customers, bills, aur bill-counter tables + security rules sab bana dega

### Authentication set karo
1. Left sidebar **Authentication → Users**
2. **Add user** → apna email + ek strong password daalo
   (yahi aapka **owner login** hoga — app isी se sign in karega)
3. Authentication → Providers mein **Email** provider already ON hoga by default — "Confirm email" ko **OFF/disable** kar dena taaki turant login ho sake (kyunki ye ek private single-owner app hai)

### API keys nikalo
1. **Project Settings (⚙️) → API**
2. Yahan se ye 2 values copy kar lo — Step 3 mein chahiye honge:
   - **Project URL**
   - **anon public** key

---

## Step 2 — GitHub pe upload karo

1. GitHub pe ek **naya repository** banao (jaise `ks-opticals`) — private rakh sakte ho
2. Is poore project folder ko us repo mein push karo:

```bash
cd ks-opticals-web
git init
git add .
git commit -m "K.S OPTICALS initial version"
git branch -M main
git remote add origin https://github.com/<aapka-username>/ks-opticals.git
git push -u origin main
```

(`.env` file kabhi commit mat karna — wo `.gitignore` mein already excluded hai)

---

## Step 3 — Vercel pe deploy karo

1. https://vercel.com/dashboard pe jao → **Add New → Project**
2. Apna GitHub repo (`ks-opticals`) import karo
3. Framework **Vite** apne aap detect ho jayega
4. **Environment Variables** section mein Step 1 ki 2 values daalo:

   | Key | Value |
   |---|---|
   | `VITE_SUPABASE_URL` | Supabase se copy ki hui Project URL |
   | `VITE_SUPABASE_ANON_KEY` | Supabase se copy ki hui anon public key |

5. **Deploy** dabao — 1-2 minute mein live ho jayega
6. Aapko ek free URL milega jaise **`ks-opticals.vercel.app`**

Bill links ab bilkul asli kaam karenge: `ks-opticals.vercel.app/bill/<token>` 🎉

---

## Step 4 — Real domain jodna hai to (optional)

Agar aap `ksopticals.com` jaisa apna khud ka domain use karna chahte ho:
1. Vercel project mein **Settings → Domains → Add**
2. Apna domain daalo → jo DNS records milen wo apne domain registrar (GoDaddy/Namecheap/etc.) mein add kar do
3. 10-30 min mein active ho jayega, phir bill links `ksopticals.com/bill/<token>` jaise honge

---

## App kaise use karein

- Deployed URL kholo → **owner email/password** se sign in karo (jo Step 1 mein Supabase Authentication mein banaya tha)
- Sab kuch same hai jo pehle artifact mein tha: Add Customer, Records, Bill generate karna, WhatsApp bhejna
- Customer ko bheja gaya bill link (`/bill/xxx`) **bina login ke** khulega — sirf usी customer ke liye jiske paas link hai

## Data safety

- Sirf aapka signed-in account **customers** table padh/likh sakta hai (Row Level Security se protected)
- Bills sirf ek special function (`get_public_bill`) ke through hi ek-ek karke exact token se khulte hain — poori list kabhi bhi kisi ko browse nahi ho sakti, chahe wo table access karne ki koshish bhi kare
