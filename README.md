<div dir="rtl" align="right">

<div align="center">

<img src="build/icon.png" alt="AntibioGram Pro" width="110"/>

# نظام تحليل حساسية المضادات الحيوية
### AntibioGram Pro

**المنظومة الإكلينيكية المتكاملة لرصد المقاومة الميكروبية وتحليل الأنماط الوبائية**

---

![Version](https://img.shields.io/badge/الإصدار-1.0.0-0d9488?style=for-the-badge)
![Platform](https://img.shields.io/badge/المنصة-Windows%207%2B-0891b2?style=for-the-badge&logo=windows)
![Standard](https://img.shields.io/badge/المعيار-CLSI%20%7C%20EUCAST-7c3aed?style=for-the-badge)
![Architecture](https://img.shields.io/badge/Electron-22-059669?style=for-the-badge&logo=electron)
![License](https://img.shields.io/badge/الترخيص-خاص-e11d48?style=for-the-badge)

</div>

---

## 📌 نبذة عن البرنامج

**نظام تحليل حساسية المضادات الحيوية** هو تطبيق سطح مكتب متكامل مصمم خصيصاً للبيئات الصحية العراقية، يعمل بالكامل دون اتصال بالإنترنت ويحافظ على سرية بيانات المرضى بشكل تام.

يُمكِّن البرنامج فرق الصيدلة السريرية ومراكز الميكروبيولوجيا من:

- إنشاء **الأنتيبيوغرام التراكمي** وفق معايير CLSI M39
- رصد **أنماط المقاومة الميكروبية** وتتبعها عبر الزمن
- مقارنة البيانات بين المستشفيات وتوليد **التقارير الإقليمية**
- اتخاذ قرارات **العلاج التجريبي** المبنية على دليل رياضي موثَّق

---

## 🖥️ لقطات من البرنامج

<div align="center">

| لوحة التحكم الرئيسية | صفحة الأنتيبيوغرام |
|:---:|:---:|
| <img src="docs/screenshots/dashboard.png" alt="Dashboard" width="420"/> | <img src="docs/screenshots/antibiogram.png" alt="Antibiogram" width="420"/> |

| تحليل الأنماط المقاومة | اللوحة الإقليمية |
|:---:|:---:|
| <img src="docs/screenshots/alerts.png" alt="AMR Alerts" width="420"/> | <img src="docs/screenshots/regional.png" alt="Regional Dashboard" width="420"/> |

| رفع البيانات — تنسيق بابل | صفحة الإعدادات |
|:---:|:---:|
| <img src="docs/screenshots/upload.png" alt="Upload" width="420"/> | <img src="docs/screenshots/settings.png" alt="Settings" width="420"/> |

</div>

---

## ✨ المميزات الرئيسية

<table>
<tr>
<td width="50%" valign="top">

### 🏥 إدارة الشبكة الاستشفائية
- شبكة غير محدودة من المستشفيات
- رفع ملف بابل متعدد الأوراق (كل ورقة = مستشفى)
- كشف تلقائي للتنسيق وإنشاء المستشفيات
- حذف جماعي بالتحديد المتعدد
- لوحة إقليمية موحدة مع خريطة حرارية

### 📊 التحليل الإحصائي
- حساب %S، %I، %R المستقل لكل فئة
- فترات ثقة ويلسون 95% لكل نتيجة
- اختبار مربع كاي مع تصحيح ياتس
- انحدار OLS الخطي لتوقع المقاومة
- علامة تحذير تلقائية عند N < 30

</td>
<td width="50%" valign="top">

### 🧬 كشف الأنماط المقاومة
- MRSA، VRE، CRE، ESBL
- CRAB، CRPA
- تصنيف MDR / XDR / PDR وفق Magiorakos 2012
- تنبيهات فورية عند رصد الأنماط الخطيرة
- حد 5% للسكان في الأنتيبيوغرام التراكمي

### 📋 التقارير والتصدير
- تصدير Excel (.xlsx) كامل
- تصدير PDF / Word للتقارير الرسمية
- طباعة الأنتيبيوغرام بتنسيق احترافي
- تقارير مقارنة بين المستشفيات
- دعم كامل للغة العربية (RTL)

</td>
</tr>
</table>

---

## 🔬 المنطق الطبي والسريري

### معايير نقاط الانكسار المعتمدة

يعمل البرنامج بمعيارين طبيين دوليين يمكن التبديل بينهما:

| المعيار | الجهة المُصدِرة | آلية التصنيف |
|---------|----------------|-------------|
| **CLSI M100** | Clinical & Laboratory Standards Institute — USA | `S ≤ X` \| `I بين X وY` \| `R ≥ Y` |
| **EUCAST 2024** | European Committee on Antimicrobial Susceptibility Testing | `S ≤ X` \| `R > X` مع فارق تقني دقيق للتراكيز غير المتصلة |

> **القاعدة الحاسمة لـ EUCAST:** عند الإعلان عن `R > X` (حد غير متصل)، فإن المعزولة ذات `MIC = X` تُصنَّف **متوسطة (I)** وليس مقاومة. لذا يستخدم البرنامج `rLimit = X × 2` (التخفيف المضاعف التالي) لضمان التصنيف الصحيح.

### مجموعات الجراثيم المُغطَّاة

```
Enterobacterales  →  E. coli · K. pneumoniae · E. cloacae · Serratia · Proteus · Citrobacter
Pseudomonas       →  P. aeruginosa
Acinetobacter     →  A. baumannii
Staphylococcus    →  S. aureus · MRSA
Enterococcus      →  E. faecalis · E. faecium
Streptococcus     →  S. pneumoniae
```

### كشف الأنماط الخطيرة — AMR Phenotypes

| الظاهرة | الجرثومة | المضاد المُشغِّل | الأهمية السريرية |
|---------|---------|-----------------|-----------------|
| **MRSA** | S. aureus | Oxacillin / Cefoxitin | خيارات محدودة — يلزم Vancomycin |
| **VRE** | Enterococcus spp. | Vancomycin / Teicoplanin | أزمة علاجية — Linezolid / Daptomycin |
| **CRE** | Enterobacterales | Carbapenems | WHO أولوية حرجة |
| **ESBL** | Enterobacterales | Cephalosporins G3/G4 | تفشٍّ واسع — يلزم Carbapenem |
| **CRAB** | A. baumannii | Carbapenems | شائع في ICU |
| **CRPA** | P. aeruginosa | Meropenem / Imipenem | علاج بالتوليف فقط |

### تصنيف MDR / XDR / PDR — Magiorakos et al., CMI 2012

| التصنيف | الاسم الكامل | التعريف |
|---------|------------|--------|
| **MDR** | Multi-Drug Resistant | مقاوم لـ ≥ 1 عامل في ≥ 3 فئات دوائية |
| **XDR** | Extensively Drug Resistant | مقاوم لجميع الفئات ما عدا ≤ 2 فئتين |
| **PDR** | Pan-Drug Resistant | مقاوم لجميع العوامل في جميع الفئات المختبَرة |

> **عتبة 5% للسكان:** في الأنتيبيوغرام التراكمي، تُعدّ الفئة الدوائية مقاومة فقط إذا بلغت نسبة المقاومة ≥ 5% — هذا يمنع تضخيم التصنيف من معزولة واحدة شاذة في عينة كبيرة.

### تغطية المضادات التجريبية — نموذج WISCA

يحسب البرنامج **احتمال التغطية الموزونة** لأي مضاد مُختار مع مراعاة توزيع الجراثيم المحلية:

```
Coverage(Ab) = Σ [ P(organism_i) × %S(organism_i, Ab) ] / Σ P(organism_i)
```

مستويات التغطية المعتمدة إكلينيكياً:

| النسبة | التقييم | القرار السريري |
|--------|---------|----------------|
| ≥ 90% | ممتازة ✅ | مضاد تجريبي مثالي |
| 80–89% | جيدة 🟡 | مقبول مع مراقبة |
| 70–79% | مقبولة ⚠️ | استخدام حذر |
| < 70% | غير كافية ❌ | لا يُنصح به تجريبياً |

---

## 📐 المنطق الرياضي

### المعادلات الأساسية

```
%S = (S / N) × 100      حيث S = عدد المعزولات الحساسة
%I = (I / N) × 100            I = عدد المعزولات متوسطة الحساسية
%R = (R / N) × 100            R = عدد المعزولات المقاومة
                               N = العدد الكلي للمعزولات
```

> ⚠️ **تحذير رياضي:** الصيغة `%R = 100 − %S` خاطئة إكلينيكياً لأنها تُسقط الفئة المتوسطة (I) وتُبالغ في المقاومة المُبلَّغ عنها.

### فترات الثقة — Wilson Score Interval (95%)

```
p̂ = S / N          z = 1.959964  (معامل z عند 95%)

CI = ( p̂ + z²/2N  ±  z√[p̂(1−p̂)/N + z²/4N²] ) / ( 1 + z²/N )
```

تُفضَّل على فترة Wald لأنها:
- لا تتجاوز الحدود [0, 1] عند العينات الصغيرة
- أكثر دقة عند p̂ قريب من 0 أو 1
- **موصى بها صراحةً في CLSI M39-A4**

### معيار الموثوقية الإحصائية

```
N ≥ 30 معزولة  →  نتيجة موثوقة          (CLSI M39-A4)
N < 30 معزولة  →  تحذير (*) تلقائي      (احتياطي إكلينيكي)
```

### اختبار مربع كاي مع تصحيح ياتس

```
χ² = N × (|ad − bc| − N/2)² / (r₁ × r₂ × c₁ × c₂)

يُفعَّل تصحيح ياتس تلقائياً حين يكون أي تكرار متوقع < 5
p-value مشتقة من تقريب Z = √χ²
```

### الانحدار الخطي OLS — توقع المقاومة

```
y  = معدل المقاومة = 100 − %S
x  = السنة

slope     = Σ(xᵢ−x̄)(yᵢ−ȳ) / Σ(xᵢ−x̄)²
intercept = ȳ − slope × x̄

التوقع: resistance(سنة) = slope × سنة + intercept   [مقيَّد في 0%–100%]
```

---

## 🏗️ المعمارية البرمجية

```
┌──────────────────────────────────────────────────────────┐
│                   Electron Shell (v22)                    │
│           Windows 7 SP1 (32/64-bit) and above            │
├───────────────────────┬──────────────────────────────────┤
│    Main Process       │       Renderer Process            │
│    (Node.js)          │       (Chromium)                  │
│                       │                                   │
│  • Window management  │  • React 18 + TypeScript          │
│  • File system I/O    │  • Vite 5 bundler                 │
│  • IPC bridge         │  • Tailwind CSS (RTL support)     │
│  • Native menus       │  • Recharts (data visualization)  │
│  • Print / Export     │  • SheetJS / XLSX parsing         │
└───────────────────────┴──────────────────────────────────┘
          │                          │
          └───────────┬──────────────┘
                      │
         ┌────────────▼────────────────┐
         │    Local Storage Engine      │
         │    (localStorage API)        │
         │  • Hospitals · Antibiogram   │
         │  • Upload History · Catalogs │
         └─────────────────────────────┘
```

### طبقات التطبيق

| الطبقة | التقنية | الدور |
|--------|---------|-------|
| **واجهة المستخدم** | React 18 + TypeScript | مكونات وظيفية + إدارة حالة محلية |
| **التصميم** | Tailwind CSS | استجابي + دعم كامل للعربية RTL |
| **الرسوم البيانية** | Recharts | مخططات تفاعلية للبيانات الطبية |
| **تحليل Excel** | SheetJS (XLSX) | ملفات .xlsx/.xls متعددة الأوراق |
| **محرك الحسابات** | TypeScript خالص | رياضيات مستقلة قابلة للاختبار |
| **قاعدة البيانات** | localStorage API | تخزين محلي — لا خوادم خارجية |
| **تصدير التقارير** | SheetJS + HTML | Excel، PDF، Word |
| **البيئة** | Electron 22 | تطبيق سطح مكتب أصلي لويندوز |

### تدفق معالجة البيانات

```
ملف Excel  (بابل متعدد الأوراق / قياسي / WHONET)
       │
       ▼
  SheetJS Parser
  • كشف التنسيق التلقائي (Babil / Standard / WHONET)
  • تطبيع أسماء الجراثيم والمضادات
  • تطبيق قاعدة المعزولة الأولى (First-Isolate Rule)
  • إزالة التكرار وإشعار المستخدم
       │
       ▼
  محرك الحسابات
  • computeSIR()          — %S، %I، %R بشكل مستقل
  • wilson95CI()          — فترة الثقة 95%
  • classifyMDR()         — MDR / XDR / PDR
  • detectAMRPhenotypes() — MRSA، VRE، CRE، ESBL، CRAB، CRPA
  • weightedCoverage()    — تغطية WISCA الموزونة
  • interpret()           — تفسير MIC وفق CLSI/EUCAST
       │
       ▼
  التخزين المحلي  (localStorage)
       │
       ▼
  واجهة المستخدم  (React 18)
  • Dashboard · AntibiogramPage · RegionalDashboard
  • AlertsPage · ComparisonPage · TrendsPage
  • WiscaPage · ReportsPage · HospitalsPage
```

---

## 🔒 أمان البيانات والخصوصية

| الجانب | التفاصيل |
|--------|---------|
| **التخزين** | محلي بالكامل — لا سحابة — لا إرسال بيانات |
| **تشفير الكوكيز** | `enableCookieEncryption: true` — Electron Fuse |
| **عزل العملية** | `runAsNode: false` — يمنع التنفيذ الخارجي |
| **سلامة الحزمة** | `onlyLoadAppFromAsar: true` — رفض أي كود خارجي |
| **تشويش الكود** | RC4 + Control Flow Flattening + Self-Defending |
| **بيانات المرضى** | لا تُغادر الجهاز أبداً |

---

## 📦 متطلبات التشغيل

| المكوِّن | الحد الأدنى |
|---------|------------|
| نظام التشغيل | Windows 7 SP1 (32-bit أو 64-bit) فما فوق |
| المعالج | Intel / AMD 1 GHz |
| الذاكرة | 2 GB RAM |
| التخزين | 500 MB مساحة خالية |
| الشاشة | 1024 × 768 أو أعلى |
| اتصال الإنترنت | **غير مطلوب** |

---

## 👥 فريق التطوير والجهة المشرفة

<div align="center">

**جمهورية العراق**

**وزارة الصحة**

دائرة صحة بابل — قسم الصيدلة

شعبة الصيدلة السريرية

*بالتعاون مع*

وحدة متابعة لجان الصيدلة والعلاج

---

**Abdallah Jawad Kadhim**

</div>

---

<div align="center">

**© 2026 Abdallah Jawad Kadhim — جميع الحقوق محفوظة**

*هذا البرنامج ملك خاص. لا يُسمح بإعادة التوزيع أو النسخ أو التعديل دون إذن كتابي صريح من المؤلف.*

</div>

</div>
