// Arabic for the sample company. The sample is written in English (seed.js);
// when it is loaded for an Arabic-speaking Head of Company, every text it writes
// passes through here: exact phrases, a few patterns, the SOP steps, and the
// strings inside JSON (call sheets, notification details).
import { SOPS } from '../../client/src/sops.js';

const PHRASES = {
  // People
  'Omar Haddad': 'عمر حداد',
  'Lina Mansour': 'لينا منصور',
  'Karim Fathy': 'كريم فتحي',
  'Nour Adel': 'نور عادل',
  'Youssef Samir': 'يوسف سمير',
  'Mariam Tarek': 'مريم طارق',
  'Hana Salah': 'هنا صلاح',
  'Ali Hassan': 'علي حسن',
  'Salma Ibrahim': 'سلمى إبراهيم',
  'Tamer Nabil': 'تامر نبيل',
  'Dina Mostafa': 'دينا مصطفى',
  'Hassan Ezz': 'حسن عز',
  'Rana Kamal': 'رنا كمال',
  'Mohamed Gamal': 'محمد جمال',
  'Farah Yasser': 'فرح ياسر',
  'Ahmed Zaki': 'أحمد زكي',
  'Sherif Abdallah': 'شريف عبدالله',
  'Aya Mahmoud': 'آية محمود',
  'Mostafa Hany': 'مصطفى هاني',
  'Nada Wael': 'ندى وائل',
  'Mai Hossam': 'مي حسام',
  'Kareem Adel': 'كريم عادل',
  'Nourhan Said': 'نورهان سعيد',
  'Youssef Hamdy': 'يوسف حمدي',
  'Mostafa Adel': 'مصطفى عادل',
  'Hossam Ali': 'حسام علي',
  'Ahmed Mahmoud': 'أحمد محمود',
  'Sara Ali': 'سارة علي',
  'Omar Khaled': 'عمر خالد',
  'Mona Hassan': 'منى حسن',
  'Youssef Adel': 'يوسف عادل',
  'Laila Samy': 'ليلى سامي',
  'Karim Nabil': 'كريم نبيل',
  'Nada Fouad': 'ندى فؤاد',
  'Tarek Ezzat': 'طارق عزت',
  'Heba Magdy': 'هبة مجدي',
  'Mahmoud Saeed': 'محمود سعيد',
  'Dalia Ashraf': 'داليا أشرف',
  'Sherif Lotfy': 'شريف لطفي',
  'Rania Adel': 'رانيا عادل',
  'Malak Hesham': 'ملك هشام',
  'Ziad Tamer': 'زياد تامر',
  'Habiba Ayman': 'حبيبة أيمن',
  'Adham Sherif': 'أدهم شريف',
  'Jana Walid': 'جنى وليد',
  'Seif Ahmed': 'سيف أحمد',
  'Rawan Khaled': 'روان خالد',
  'Marwan Hesham': 'مروان هشام',
  'Nour El Din Ali': 'نور الدين علي',
  'Farida Mostafa': 'فريدة مصطفى',
  'Yassin Omar': 'ياسين عمر',
  'Lojain Samir': 'لجين سمير',

  // Projects
  'Physics 101 — Term 1 Course': 'فيزياء 101 — كورس الترم الأول',
  'Record, edit and QA all Term 1 physics lessons before launch.': 'تسجيل ومونتاج ومراجعة جودة كل دروس فيزياء الترم الأول قبل الإطلاق.',
  'Back-to-School Campaign': 'حملة العودة للدراسة',
  'Multi-channel enrollment campaign for the new term.': 'حملة تسجيل على كل القنوات للترم الجديد.',
  'Platform v2.4 Release': 'إصدار المنصة 2.4',
  'New quiz engine, video player fixes and student dashboard.': 'نظام كويزات جديد، وتصليحات مشغّل الفيديو، ولوحة الطالب.',
  'Support Backlog Cleanup': 'تصفية طلبات الدعم المتأخرة',
  'Clear the backlog of open student tickets and update the FAQ.': 'خلّص طلبات الطلبة المفتوحة وحدّث الأسئلة الشائعة.',
  'Q4 Content Quality Audit': 'مراجعة جودة المحتوى — الربع الرابع',
  'Audit published lessons against the quality checklist.': 'مراجعة الدروس المنشورة على قائمة معايير الجودة.',
  'Chemistry — Term 1 Academic Material': 'الكيمياء — المادة العلمية للترم الأول',
  'Homework, exams and student questions for the chemistry course, at the centers and on the platform.': 'واجبات وامتحانات وأسئلة طلبة كورس الكيمياء، في السناتر وعلى المنصة.',
  'Baccalaureate Chemistry': 'كيمياء البكالوريا',
  'Exam models, answers and student questions for the Baccalaureate track.': 'نماذج امتحانات وإجابات وأسئلة طلبة مسار البكالوريا.',
  'Online platform — Term 1': 'المنصة الإلكترونية — الترم الأول',
  'What goes on the platform and when: lessons, exams, forums and student complaints.': 'إيه اللي بينزل على المنصة وإمتى: الدروس والامتحانات والمنتديات وشكاوى الطلبة.',

  // Content
  'Record Lesson 1: Motion & Velocity': 'تسجيل الدرس 1: الحركة والسرعة',
  'Record Lesson 2: Newton’s Laws': 'تسجيل الدرس 2: قوانين نيوتن',
  'Cover all three laws with real-world examples. Include a 5-question quiz at the end.': 'اشرح القوانين التلاتة بأمثلة من الحياة، وفي الآخر كويز من 5 أسئلة.',
  'Script approved': 'السكريبت متوافق عليه',
  Recording: 'التسجيل',
  Editing: 'المونتاج',
  'Quiz questions uploaded': 'أسئلة الكويز اترفعت',
  'Uploaded the final cut — ready for QA.': 'رفعت النسخة النهائية — جاهزة للمراجعة.',
  'Record Lesson 3: Work & Energy': 'تسجيل الدرس 3: الشغل والطاقة',
  'Write worksheet for Lessons 1–3': 'ورقة تمارين للدروس 1–3',
  'Fix audio sync on Lesson 1 intro': 'تظبيط تزامن الصوت في مقدمة الدرس 1',
  'Audio drifts ~0.5s behind video after 02:10.': 'الصوت بيتأخر نص ثانية عن الصورة بعد 02:10.',
  'Waiting on the raw footage backup from Systems Ops.': 'مستني نسخة التصوير الخام من عمليات الأنظمة.',
  'Approve Term 1 syllabus': 'اعتماد منهج الترم الأول',

  // Marketing
  'Design social media creatives': 'تصميم بوستات السوشيال ميديا',
  'Write email announcement sequence': 'كتابة سلسلة إيميلات الإعلان',
  'Film teaser video with instructor': 'تصوير فيديو تشويقي مع المدرس',
  'A 30-second teaser for Physics 101.': 'فيديو تشويقي 30 ثانية لكورس فيزياء 101.',
  'Launch paid ads': 'إطلاق الإعلانات المدفوعة',
  'Competitor pricing research': 'دراسة أسعار المنافسين',

  // Product / systems
  'Quiz engine: support image answers': 'نظام الكويزات: إجابات بالصور',
  'Video player freezes on Safari': 'مشغّل الفيديو بيقف على سفاري',
  'Reported by 14 students this week. Reproducible on Safari 17.': 'بلّغ عنه 14 طالب الأسبوع ده، وبيتكرر على سفاري 17.',
  'Raising this from the support queue — top complaint right now.': 'رافعاه من طلبات الدعم — أكتر شكوى دلوقتي.',
  'Regression test plan for v2.4': 'خطة اختبار الإصدار 2.4',
  'Student dashboard wireframes sign-off': 'اعتماد تصميمات لوحة الطالب',

  // Customer service
  'Answer refund tickets older than 3 days': 'الرد على طلبات الاسترداد الأقدم من 3 أيام',
  'Update FAQ: login & password reset': 'تحديث الأسئلة الشائعة: الدخول واسترجاع كلمة السر',
  'Weekly ticket summary for leadership': 'ملخص أسبوعي للطلبات للإدارة',
  'Call back students with failed payments': 'الاتصال بالطلبة اللي الدفع عندهم فشل',

  // Systems ops / QC
  'Define content quality checklist': 'تحديد قائمة معايير جودة المحتوى',
  'Audio levels': 'مستوى الصوت',
  'Captions accuracy': 'دقة الترجمة',
  'Slide typos': 'الأخطاء الإملائية في السلايدز',
  'Quiz answer key': 'نموذج إجابة الكويز',
  'Spot-check 20 published lessons': 'فحص عينة 20 درس منشور',
  'Back up raw lesson footage to cold storage': 'نسخ تصوير الدروس الخام للتخزين طويل المدى',

  // Leadership
  'Q4 budget review': 'مراجعة ميزانية الربع الرابع',
  'Monthly all-hands agenda': 'أجندة الاجتماع الشهري لكل الشركة',
  'Hire two new instructors': 'تعيين مدرسين جداد',
  'Approve the Back-to-School campaign budget': 'اعتماد ميزانية حملة العودة للدراسة',
  'Paid ads, influencer posts and printed flyers for the new term. Total: 85,000 EGP.': 'إعلانات مدفوعة وبوستات مؤثرين وفلايرات مطبوعة للترم الجديد. الإجمالي: 85,000 جنيه.',
  'The breakdown per channel is attached in the campaign folder.': 'التفصيل لكل قناة موجود في فولدر الحملة.',
  'Sign the renewal contract with Maadi Center': 'إمضاء عقد تجديد سنتر المعادي',
  'Choose the platform pricing for next term': 'تحديد أسعار المنصة للترم الجاي',
  'Compare competitor prices': 'مقارنة أسعار المنافسين',
  'Review last term sign-ups': 'مراجعة تسجيلات الترم اللي فات',
  'Decide on early-bird discount': 'تحديد خصم الحجز المبكر',
  'Interview candidates for Marketing Lead': 'مقابلات المرشحين لقيادة التسويق',
  'Term 1 launch plan': 'خطة إطلاق الترم الأول',
  'Timeline, owners and risks for launching Physics 101 on the platform and in the centers.': 'الجدول الزمني والمسؤولين والمخاطر لإطلاق فيزياء 101 على المنصة وفي السناتر.',
  'Ready for your sign-off. The main risk is the Safari video bug.': 'جاهزة لاعتمادك. أكبر خطر هو مشكلة الفيديو على سفاري.',

  // Calls
  'Failed payments — October': 'مدفوعات فاشلة — أكتوبر',
  'Students whose card payment failed this month.': 'الطلبة اللي الدفع بالكارت فشل عندهم الشهر ده.',
  Name: 'الاسم',
  Phone: 'التليفون',
  Email: 'الإيميل',
  Course: 'الكورس',
  Amount: 'المبلغ',
  'Physics 101': 'فيزياء 101',
  Chemistry: 'كيمياء',
  Math: 'رياضيات',
  'Paid by bank transfer.': 'دفع بتحويل بنكي.',
  'Asked to call after 6pm.': 'طلب نكلمه بعد 6 المغرب.',
  'Will retry the card tonight.': 'هيجرب الكارت تاني النهارده بالليل.',

  // Centers
  'Nasr City Center': 'سنتر مدينة نصر',
  'Maadi Center': 'سنتر المعادي',
  'Heliopolis Center': 'سنتر مصر الجديدة',
  'Smouha Center': 'سنتر سموحة',
  Cairo: 'القاهرة',
  Alexandria: 'الإسكندرية',
  '12 Abbas El Akkad St.': '12 شارع عباس العقاد',
  'Road 9, Maadi': 'شارع 9، المعادي',
  '45 El Merghany St.': '45 شارع الميرغني',
  '7 Fawzy Moaz St., Smouha': '7 شارع فوزي معاذ، سموحة',
  'Term 2 — center sessions': 'الترم الثاني — حصص السناتر',
  'Add every weekly slot you can teach in person.': 'ضيف كل المواعيد الأسبوعية اللي تقدر تدرّس فيها حضوري.',
  'Prefer east Cairo centers.': 'أفضّل سناتر شرق القاهرة.',
  'Physics — Grade 12': 'فيزياء — تالتة ثانوي',
  'Physics — Grade 11': 'فيزياء — تانية ثانوي',
  'Chemistry — Grade 12': 'كيمياء — تالتة ثانوي',
  'Chemistry — Grade 11': 'كيمياء — تانية ثانوي',

  // Academic Material
  'Grade Lesson 4 homework — Nasr City Center': 'تصحيح واجب الدرس 4 — سنتر مدينة نصر',
  '64 papers from the Saturday group. Record the marks in the sheet before Monday.': '64 ورقة من مجموعة السبت. سجّل الدرجات قبل الاتنين.',
  'Group A (32 papers)': 'مجموعة أ (32 ورقة)',
  'Group B (32 papers)': 'مجموعة ب (32 ورقة)',
  'Enter the marks': 'تسجيل الدرجات',
  'Proctor the monthly exam — Maadi Center': 'مراقبة الامتحان الشهري — سنتر المعادي',
  'Friday 10:00–12:00, hall 2. Be there 30 minutes early.': 'الجمعة 10:00–12:00، قاعة 2. تعالى قبلها بنص ساعة.',
  'Grade the monthly exam papers — Maadi Center': 'تصحيح ورق الامتحان الشهري — سنتر المعادي',
  'Take student questions — Heliopolis Saturday class': 'استقبال أسئلة الطلبة — حصة السبت بمصر الجديدة',
  'Grade Lesson 3 homework — Azhar group': 'تصحيح واجب الدرس 3 — مجموعة الأزهر',
  'Write the October exam — models A and B': 'كتابة امتحان أكتوبر — نموذج أ ونموذج ب',
  'Model A': 'نموذج أ',
  'Model B': 'نموذج ب',
  'Mark scheme': 'توزيع الدرجات',
  'Answers for the October exam': 'إجابات امتحان أكتوبر',
  'Review the model answer for exam 3': 'مراجعة المودل أنسر للامتحان 3',
  'Checked every answer against the book. Question 7 had a wrong unit — fixed.': 'راجعت كل إجابة على الكتاب. السؤال 7 كانت وحدته غلط — اتصلحت.',
  'Homework 5 model answer (General)': 'نموذج إجابة الواجب 5 (عام)',
  'Homework 5 model answer (Azhar)': 'نموذج إجابة الواجب 5 (أزهر)',
  'Review the Homework 5 answer key': 'مراجعة نموذج إجابة الواجب 5',
  'Answer student questions on the platform — Lesson 4': 'الرد على أسئلة الطلبة على المنصة — الدرس 4',
  '23 open questions. Reply within 24 hours.': '23 سؤال مفتوح. الرد خلال 24 ساعة.',
  'Grade the essay questions on the platform — Quiz 6': 'تصحيح الأسئلة المقالية على المنصة — كويز 6',
  'Baccalaureate: exam model for Unit 1': 'البكالوريا: نموذج امتحان الوحدة الأولى',
  'Baccalaureate: answer student questions on the platform': 'البكالوريا: الرد على أسئلة الطلبة على المنصة',
  'Every week: solve the three external books, the teacher’s book and the exam, and attend the class.': 'كل أسبوع: حل 3 كتب خارجية وكتاب المستر والامتحان، وحضور الحصة.',

  // Platform
  'Motion & Velocity': 'الحركة والسرعة',
  'Newton’s Laws': 'قوانين نيوتن',
  'Work & Energy': 'الشغل والطاقة',
  Momentum: 'كمية الحركة',
  'Circular Motion': 'الحركة الدائرية',
  Gravity: 'الجاذبية',
  Waves: 'الموجات',
  Sound: 'الصوت',
  'Reaction Rates': 'سرعة التفاعل',
  'Chemical Equilibrium': 'الاتزان الكيميائي',
  'Galvanic Cells': 'الخلايا الجلفانية',
  Electrolysis: 'التحليل الكهربي',
  'Waiting on the final cut from the content team.': 'مستنيين النسخة النهائية من فريق المحتوى.',
  'Physics Unit 1 exam on the platform': 'امتحان الوحدة الأولى فيزياء على المنصة',
  'Chemistry Quiz 6 on the platform': 'كويز 6 كيمياء على المنصة',
  'Publish the results of Physics Quiz 5': 'نشر نتايج كويز 5 فيزياء',
  'Forum moderation — this week': 'متابعة المنتدى — الأسبوع ده',
  'Pin the answer about exam attempts in the forum': 'تثبيت الرد عن محاولات الامتحان في المنتدى',
  'Complaint: video stops after 10 minutes (Sara Ali)': 'شكوى: الفيديو بيقف بعد 10 دقايق (سارة علي)',
  'Happens on Physics Lesson 3 on her phone. Phone: +20 100 123 4502.': 'بيحصل في الدرس 3 فيزياء على موبايلها. التليفون: 4502 123 100 20+.',
  'Reproduced on Android Chrome. Passing it to Systems Ops as a bug.': 'اتكررت على كروم أندرويد. هحوّلها لعمليات الأنظمة كخلل.',
  'Complaint: charged twice for Physics 101': 'شكوى: اتخصم مرتين على فيزياء 101',
  'Complaint: exam closed before the time ended': 'شكوى: الامتحان اتقفل قبل الوقت ما يخلص',
  'Complaint: my forum post was removed': 'شكوى: البوست بتاعي في المنتدى اتمسح',

  // Customer Service team leader
  'Score 5 of Youssef’s calls this week': 'تقييم 5 مكالمات ليوسف الأسبوع ده',
  'Train Youssef on the refund script': 'تدريب يوسف على سكريبت الاسترداد',
  'Student cannot open Lesson 4 on his phone': 'طالب مش قادر يفتح الدرس 4 على موبايله',
  'Annual leave': 'إجازة سنوية',

  // Video editors
  'Film Physics Lesson 5: Circular Motion with Youssef': 'تصوير الدرس 5 فيزياء: الحركة الدائرية مع يوسف',
  'Edit Physics Lesson 4: Momentum': 'مونتاج الدرس 4 فيزياء: كمية الحركة',
  'Edit Physics Lesson 3: Work & Energy': 'مونتاج الدرس 3 فيزياء: الشغل والطاقة',
  'Photo shoot for the Back-to-School campaign': 'جلسة تصوير لحملة العودة للدراسة',

  // Grades
  'Saturday 10 am': 'السبت 10 ص',
  'Sunday 4 pm': 'الأحد 4 م',
  'Homework 4 — Reaction rates': 'الواجب 4 — سرعة التفاعل',
  'Monthly exam — October': 'الامتحان الشهري — أكتوبر',
  'Quiz 6 — Chemical equilibrium': 'كويز 6 — الاتزان الكيميائي',
  'Late, came in at minute 20': 'اتأخر، دخل في الدقيقة 20',
  'Wrote the rate as concentration × time instead of change in concentration ÷ time': 'كتب السرعة تركيز × زمن بدل التغير في التركيز ÷ الزمن',
  'Forgot the units (mol/L·s)': 'نسي الوحدة (مول/لتر·ث)',
  'Re-explain units at the start of Saturday’s class': 'نعيد شرح الوحدات في أول حصة السبت',
  'Did not balance the equation before using the mole ratio': 'ما وزنش المعادلة قبل ما يستخدم النسبة المولية',
  'Mixed up exothermic and endothermic on the energy diagram': 'لخبط بين الطارد والماص للحرارة في منحنى الطاقة',
  'Put the solids in the equilibrium constant expression': 'حط المواد الصلبة في تعبير ثابت الاتزان',
  Q2: 'س2',
  Q3: 'س3',
  Q4: 'س4',
  Q7: 'س7',
  Q12: 'س12',
};

// Every SOP step, from English to Arabic (the sample ticks some of them).
for (const sop of Object.values(SOPS)) sop.en.steps.forEach((s, i) => (PHRASES[s.text] ??= sop.ar.steps[i]?.text));

const PATTERNS = [
  [/^Upload Physics Lesson (\d+): (.+)$/, (m) => `رفع درس الفيزياء ${m[1]}: ${PHRASES[m[2]] ?? m[2]}`],
  [/^Upload Chemistry Lesson (\d+): (.+)$/, (m) => `رفع درس الكيمياء ${m[1]}: ${PHRASES[m[2]] ?? m[2]}`],
  [/^Weekly duties — week of (.+)$/, (m) => `المهام الأسبوعية — أسبوع ${m[1]}`],
  [/^Solve external book (\d)$/, (m) => ['', 'حل الكتاب الخارجي الأول', 'حل الكتاب الخارجي الثاني', 'حل الكتاب الخارجي الثالث'][m[1]]],
];

function arabic(s) {
  if (PHRASES[s] !== undefined) return PHRASES[s];
  for (const [re, fn] of PATTERNS) {
    const m = re.exec(s);
    if (m) return fn(m);
  }
  // Strings inside JSON: call sheets (their column names too), notification details.
  if (/^[[{]/.test(s)) {
    try {
      return JSON.stringify(deep(JSON.parse(s)));
    } catch {
      return s;
    }
  }
  return s;
}

const deep = (v) =>
  typeof v === 'string'
    ? arabic(v)
    : Array.isArray(v)
      ? v.map(deep)
      : v && typeof v === 'object'
        ? Object.fromEntries(Object.entries(v).map(([k, x]) => [PHRASES[k] ?? k, deep(x)]))
        : v;

// A function applied to every value the sample writes (non-strings pass through).
export const sampleTranslator = (lang) => (lang === 'ar' ? (v) => (typeof v === 'string' ? arabic(v) : v) : (v) => v);
