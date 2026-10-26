// Standard operating procedures: the steps every task of a type goes through.
// A new task starts with its type's steps as its checklist. These are the
// built-in versions; a manager can replace one from the SOPs page (stored in
// the sops table). Shared by the web app and the server.

export const SOPS = {
  general: {
    en: ['Read the task and ask the requester about anything unclear', 'Do the work', 'Check the result against what was asked', 'Comment with a short summary and mark it done'],
    ar: ['اقرأ المهمة واسأل صاحب الطلب عن أي حاجة مش واضحة', 'نفّذ الشغل', 'راجع النتيجة على المطلوب', 'اكتب تعليق بملخص قصير وقفّل المهمة'],
  },
  content: {
    en: ['Write the script and get it approved', 'Prepare slides and examples', 'Record the lesson', 'Edit and add captions', 'Upload the quiz questions', 'Send to Content Quality for review'],
    ar: ['اكتب السكريبت وخد الموافقة عليه', 'جهّز السلايدز والأمثلة', 'سجّل الدرس', 'المونتاج وإضافة الترجمة', 'ارفع أسئلة الدرس', 'ابعته لجودة المحتوى للمراجعة'],
  },
  content_review: {
    en: ['Watch the whole lesson', 'Check the scientific accuracy', 'Check audio, video and captions', 'Check the quiz and its answer key', 'Approve, or request changes with clear notes'],
    ar: ['شوف الدرس كله', 'راجع الدقة العلمية', 'راجع الصوت والصورة والترجمة', 'راجع الأسئلة ونموذج إجابتها', 'وافق، أو اطلب تعديلات بملاحظات واضحة'],
  },
  qc_check: {
    en: ['Open the quality checklist', 'Check every item and note what fails', 'Take screenshots of problems', 'Send the findings to the owner', 'Re-check after the fixes'],
    ar: ['افتح قائمة معايير الجودة', 'راجع كل بند وسجّل اللي فيه مشكلة', 'خد سكرين شوت للمشاكل', 'ابعت الملاحظات للمسؤول', 'راجع تاني بعد التعديل'],
  },
  campaign: {
    en: ['Agree the goal, audience and budget', 'Write the copy', 'Design the creatives', 'Get approval', 'Publish and schedule', 'Report the results after a week'],
    ar: ['اتفق على الهدف والجمهور والميزانية', 'اكتب الكلام', 'صمّم البوستات', 'خد الموافقة', 'انشر وجدول', 'اعمل تقرير بالنتايج بعد أسبوع'],
  },
  support: {
    en: ['Read the student’s request and history', 'Reproduce or confirm the problem', 'Reply with a solution or next step', 'Escalate to the right team if needed', 'Confirm with the student that it is solved'],
    ar: ['اقرأ طلب الطالب وتاريخه', 'اتأكد من المشكلة', 'رد بالحل أو الخطوة الجاية', 'صعّد للفريق المسؤول لو محتاج', 'اتأكد مع الطالب إن المشكلة اتحلت'],
  },
  bug: {
    en: ['Write the steps to reproduce', 'Note the device, browser and account', 'Attach screenshots or a recording', 'Fix it', 'Test the fix', 'Tell Customer Service it is fixed'],
    ar: ['اكتب خطوات تكرار المشكلة', 'سجّل الجهاز والمتصفح والحساب', 'أرفق صور أو فيديو', 'صلّح المشكلة', 'اختبر التصليح', 'بلّغ خدمة العملاء إنها اتصلحت'],
  },
  feature: {
    en: ['Write the problem it solves and who asked', 'Agree what is in and out', 'Design', 'Build', 'Test', 'Release and announce'],
    ar: ['اكتب المشكلة اللي بتحلها ومين طلبها', 'اتفق على المطلوب بالظبط', 'التصميم', 'التنفيذ', 'الاختبار', 'الإطلاق والإعلان'],
  },
  operations: {
    en: ['Agree the outcome and deadline', 'List what is needed and who does it', 'Do it', 'Update the people affected', 'Record it where the team can find it'],
    ar: ['اتفق على النتيجة المطلوبة والمعاد', 'حدد المطلوب ومين هيعمله', 'نفّذ', 'بلّغ الناس المعنيين', 'سجّله في مكان الفريق يلاقيه'],
  },

  // Academic Material
  hw_grading: {
    en: ['Collect the homework papers from the center', 'Grade using the homework model answer', 'Write a note on common mistakes', 'Enter the marks in the sheet', 'Return the papers to the center', 'Send the common mistakes to the teacher'],
    ar: ['استلم ورق الواجب من السنتر', 'صحّح على نموذج إجابة الواجب', 'سجّل الأخطاء المتكررة', 'ادخل الدرجات في الشيت', 'سلّم الورق للسنتر', 'ابعت الأخطاء المتكررة للمستر'],
  },
  exam_proctoring: {
    en: ['Arrive 30 minutes before the exam', 'Check the papers and the number of students', 'Check student IDs and seating', 'Proctor without leaving the hall', 'Collect and count the papers', 'Hand the papers to the person grading'],
    ar: ['احضر قبل الامتحان بنص ساعة', 'راجع الورق وعدد الطلبة', 'راجع أسماء الطلبة وأماكن القعدة', 'راقب من غير ما تسيب القاعة', 'اجمع الورق وعدّه', 'سلّم الورق للي هيصحح'],
  },
  exam_grading: {
    en: ['Get the exam papers and the model answer', 'Grade every paper on the model answer', 'Second-check a sample of papers', 'Enter the marks in the sheet', 'Report the top students and the most missed questions'],
    ar: ['استلم ورق الامتحان ونموذج الإجابة', 'صحّح كل الورق على النموذج', 'راجع عينة من الورق مرة تانية', 'ادخل الدرجات في الشيت', 'بلّغ بأوائل الطلبة وأكتر أسئلة غلط فيها الطلبة'],
  },
  center_questions: {
    en: ['Be at the center at the agreed time', 'Answer the students’ questions', 'Write down questions you could not answer', 'Get the answers from the teacher', 'Send the answers back to those students'],
    ar: ['احضر السنتر في المعاد المتفق عليه', 'جاوب على أسئلة الطلبة', 'سجّل الأسئلة اللي معرفتش تجاوبها', 'خد إجابتها من المستر', 'ابعت الإجابة للطلبة دول'],
  },
  exam_papers: {
    en: ['Agree the lessons and the number of models', 'Write the questions (all difficulty levels)', 'Make model A and model B', 'Check the time needed and the marks', 'Format the paper', 'Send it for review'],
    ar: ['اتفق على الدروس وعدد النماذج', 'اكتب الأسئلة (كل المستويات)', 'اعمل نموذج A ونموذج B', 'راجع الوقت والدرجات', 'نسّق الورقة', 'ابعتها للمراجعة'],
  },
  exam_answers: {
    en: ['Solve every question in full', 'Write the mark scheme for each question', 'Note the alternative correct answers', 'Format the answer sheet', 'Send it for review'],
    ar: ['حل كل الأسئلة بالتفصيل', 'اكتب توزيع الدرجات لكل سؤال', 'سجّل الإجابات الصحيحة التانية المقبولة', 'نسّق ورقة الإجابة', 'ابعتها للمراجعة'],
  },
  model_answer_review: {
    en: ['Solve the exam yourself without looking', 'Compare with the model answer', 'Check units, numbers and the mark scheme', 'Write the corrections', 'Approve the final version'],
    ar: ['حل الامتحان بنفسك من غير ما تبص على الإجابة', 'قارن بالمودل أنسر', 'راجع الوحدات والأرقام وتوزيع الدرجات', 'اكتب التصحيحات', 'اعتمد النسخة النهائية'],
  },
  hw_model_answer: {
    en: ['Choose the track: Azhar or General', 'Solve every question in full', 'Add short explanations where students usually go wrong', 'Format it', 'Send it for review'],
    ar: ['حدد المسار: أزهر أو عام', 'حل كل الأسئلة بالتفصيل', 'زوّد شرح بسيط في الأماكن اللي الطلبة بتغلط فيها', 'نسّقه', 'ابعته للمراجعة'],
  },
  answer_key_review: {
    en: ['Solve the questions yourself', 'Compare with the answer key', 'Check the track (Azhar / General) matches', 'Write the corrections', 'Approve the final version'],
    ar: ['حل الأسئلة بنفسك', 'قارن بنموذج الإجابة', 'اتأكد إن المسار (أزهر / عام) صح', 'اكتب التصحيحات', 'اعتمد النسخة النهائية'],
  },
  platform_questions: {
    en: ['Open the questions waiting on the platform', 'Reply within 24 hours', 'Send hard questions to the teacher', 'Note questions that repeat', 'Close the answered questions'],
    ar: ['افتح الأسئلة المستنية على المنصة', 'رد خلال 24 ساعة', 'ابعت الأسئلة الصعبة للمستر', 'سجّل الأسئلة اللي بتتكرر', 'قفّل الأسئلة اللي اتجاوبت'],
  },
  essay_grading: {
    en: ['Open the essay answers on the platform', 'Grade on the model answer', 'Write short feedback for each student', 'Publish the marks', 'Report the common mistakes to the teacher'],
    ar: ['افتح الإجابات المقالية على المنصة', 'صحّح على نموذج الإجابة', 'اكتب ملاحظة قصيرة لكل طالب', 'انشر الدرجات', 'بلّغ المستر بالأخطاء المتكررة'],
  },
  weekly_duties: {
    en: ['Solve external book 1', 'Solve external book 2', 'Solve external book 3', 'Solve the teacher’s book', 'Solve the exam', 'Attend the class'],
    ar: ['حل الكتاب الخارجي الأول', 'حل الكتاب الخارجي الثاني', 'حل الكتاب الخارجي الثالث', 'حل كتاب المستر', 'حل الامتحان', 'حضور الحصة'],
  },
};

// The task types someone works with: the Academic Material team has its own
// work (and General); other teams don't see it. Leadership sees everything.
export function typesFor(taskTypes, department) {
  if (department === 'executive' || department === 'operations') return taskTypes;
  if (department === 'academic') return taskTypes.filter((x) => x.group === 'academic' || x.key === 'general');
  return taskTypes.filter((x) => x.group !== 'academic');
}

// Managers change the SOPs of the types their department works with;
// leadership changes any.
export function canEditSop(roles, role, taskTypes, type) {
  const r = roles[role];
  if (!r || r.level === 'member') return false;
  return typesFor(taskTypes, r.department).some((x) => x.key === type);
}

// A type's steps: the custom version if a manager set one, else the built-in one.
export const sopSteps = (type, lang, custom) => custom?.[type]?.steps ?? SOPS[type]?.[lang === 'ar' ? 'ar' : 'en'] ?? [];
