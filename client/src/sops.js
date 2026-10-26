// Standard operating procedures: how each type of task is done. A new task
// starts with its type's steps as its checklist; required steps must be ticked
// before the task goes to review or is marked done. These are the built-in
// versions; a manager can replace one from the SOPs page (stored in the sops
// table). Shared by the web app and the server.
//
// Each SOP, per language: when (when it applies), target (how quickly), steps
// (a leading "!" marks a required step) and done (what finished looks like).

const BUILT_IN = {
  general: {
    en: {
      when: 'Any task that has no more specific type.',
      target: 'By the due date.',
      steps: ['Read the task and ask the requester about anything unclear', 'Do the work', 'Check the result against what was asked', 'Comment with a short summary of what was done'],
      done: 'The requester has what they asked for, and the summary is in the comments.',
    },
    ar: {
      when: 'أي مهمة مالهاش نوع أدق.',
      target: 'قبل معاد التسليم.',
      steps: ['اقرأ المهمة واسأل صاحب الطلب عن أي حاجة مش واضحة', 'نفّذ الشغل', 'راجع النتيجة على المطلوب', 'اكتب تعليق بملخص اللي اتعمل'],
      done: 'صاحب الطلب استلم المطلوب، والملخص مكتوب في التعليقات.',
    },
  },
  content: {
    en: {
      when: 'Recording a new lesson or re-recording one.',
      target: 'Ready for review 2 days before the lesson is due on the platform.',
      steps: ['!Write the script and get it approved by the Head of Content', 'Prepare slides and worked examples', '!Record the lesson', 'Edit, and add captions', '!Upload the quiz questions with their answer key', '!Send to Content Quality for review'],
      done: 'Content Quality approved the lesson and the final files are in the course folder.',
    },
    ar: {
      when: 'تسجيل درس جديد أو إعادة تسجيل درس.',
      target: 'جاهز للمراجعة قبل معاد نزوله على المنصة بيومين.',
      steps: ['!اكتب السكريبت وخد موافقة رئيس قسم المحتوى', 'جهّز السلايدز والأمثلة المحلولة', '!سجّل الدرس', 'المونتاج وإضافة الترجمة', '!ارفع أسئلة الدرس ونموذج إجابتها', '!ابعته لجودة المحتوى للمراجعة'],
      done: 'جودة المحتوى وافقت على الدرس، والملفات النهائية في فولدر الكورس.',
    },
  },
  content_review: {
    en: {
      when: 'A lesson or material is waiting for quality review.',
      target: 'Within 2 working days of being sent.',
      steps: ['Watch the whole lesson', '!Check the scientific accuracy', 'Check audio, video and captions', '!Check the quiz and its answer key', '!Approve, or request changes with clear, numbered notes'],
      done: 'Approved, or sent back with every change needed written down.',
    },
    ar: {
      when: 'درس أو مادة مستنية مراجعة الجودة.',
      target: 'خلال يومين شغل من وصولها.',
      steps: ['شوف الدرس كله', '!راجع الدقة العلمية', 'راجع الصوت والصورة والترجمة', '!راجع الأسئلة ونموذج إجابتها', '!وافق، أو اطلب تعديلات بملاحظات واضحة ومترقّمة'],
      done: 'اتوافق عليه، أو رجع ومعاه كل التعديلات المطلوبة مكتوبة.',
    },
  },
  qc_check: {
    en: {
      when: 'A planned quality check of published content or a process.',
      target: 'By the due date; urgent problems reported the same day.',
      steps: ['Open the quality checklist', '!Check every item and note what fails', 'Take screenshots of problems', '!Send the findings to the owner', 'Re-check after the fixes'],
      done: 'Every problem found is fixed or has an owner and a date.',
    },
    ar: {
      when: 'فحص جودة مخطط لمحتوى منشور أو لطريقة شغل.',
      target: 'قبل معاد التسليم، والمشاكل العاجلة تتبلّغ في نفس اليوم.',
      steps: ['افتح قائمة معايير الجودة', '!راجع كل بند وسجّل اللي فيه مشكلة', 'خد سكرين شوت للمشاكل', '!ابعت الملاحظات للمسؤول', 'راجع تاني بعد التعديل'],
      done: 'كل مشكلة اتلقت اتصلحت، أو ليها مسؤول ومعاد.',
    },
  },
  campaign: {
    en: {
      when: 'Any paid or organic marketing campaign.',
      target: 'Live on the planned launch date.',
      steps: ['!Agree the goal, audience and budget', 'Write the copy', 'Design the creatives', '!Get approval from the Marketing Manager', 'Publish and schedule', '!Report the results after a week'],
      done: 'The campaign ran and its results (reach, leads, cost per lead) are reported.',
    },
    ar: {
      when: 'أي حملة تسويقية مدفوعة أو مجانية.',
      target: 'تنزل في معاد الإطلاق المخطط.',
      steps: ['!اتفق على الهدف والجمهور والميزانية', 'اكتب الكلام', 'صمّم البوستات', '!خد موافقة مدير التسويق', 'انشر وجدول', '!اعمل تقرير بالنتايج بعد أسبوع'],
      done: 'الحملة نزلت ونتايجها (الوصول، العملاء المحتملين، تكلفة العميل) متسجلة.',
    },
  },
  support: {
    en: {
      when: 'A student asks for help by phone, chat or email.',
      target: 'First reply within 4 working hours; solved within 2 days.',
      steps: ['Read the student’s request and history', 'Confirm the problem', '!Reply with a solution or the next step', 'Escalate to the right team if needed', '!Confirm with the student that it is solved'],
      done: 'The student confirmed the problem is solved.',
    },
    ar: {
      when: 'طالب طلب مساعدة بالتليفون أو الشات أو الإيميل.',
      target: 'أول رد خلال 4 ساعات شغل، والحل خلال يومين.',
      steps: ['اقرأ طلب الطالب وتاريخه', 'اتأكد من المشكلة', '!رد بالحل أو الخطوة الجاية', 'صعّد للفريق المسؤول لو محتاج', '!اتأكد مع الطالب إن المشكلة اتحلت'],
      done: 'الطالب أكّد إن المشكلة اتحلت.',
    },
  },
  bug: {
    en: {
      when: 'Something on the platform is broken.',
      target: 'Urgent (students blocked): same day. Others: within the week.',
      steps: ['!Write the steps to reproduce', 'Note the device, browser and account', 'Attach screenshots or a recording', '!Fix it', '!Test the fix on the same device', 'Tell Customer Service it is fixed'],
      done: 'Fixed, tested, and Customer Service has told the students affected.',
    },
    ar: {
      when: 'حاجة بايظة على المنصة.',
      target: 'العاجل (الطلبة واقفين): نفس اليوم. الباقي: خلال الأسبوع.',
      steps: ['!اكتب خطوات تكرار المشكلة', 'سجّل الجهاز والمتصفح والحساب', 'أرفق صور أو فيديو', '!صلّح المشكلة', '!اختبر التصليح على نفس الجهاز', 'بلّغ خدمة العملاء إنها اتصلحت'],
      done: 'اتصلحت واتختبرت، وخدمة العملاء بلّغت الطلبة اللي اتأثروا.',
    },
  },
  feature: {
    en: {
      when: 'A new ability for the platform has been requested.',
      target: 'Planned in the next sprint review.',
      steps: ['!Write the problem it solves and who asked', 'Agree what is in and out', 'Design', 'Build', '!Test', 'Release and announce'],
      done: 'Released, and the people who asked for it know.',
    },
    ar: {
      when: 'حد طلب إمكانية جديدة على المنصة.',
      target: 'تتخطط في مراجعة الـ sprint الجاية.',
      steps: ['!اكتب المشكلة اللي بتحلها ومين طلبها', 'اتفق على المطلوب بالظبط', 'التصميم', 'التنفيذ', '!الاختبار', 'الإطلاق والإعلان'],
      done: 'نزلت، واللي طلبوها عارفين.',
    },
  },
  operations: {
    en: {
      when: 'Running the company: contracts, budgets, hiring, centers.',
      target: 'By the due date.',
      steps: ['Agree the outcome and deadline', 'List what is needed and who does it', '!Do it', 'Update the people affected', '!Record it where the team can find it'],
      done: 'Done, and the record (contract, sheet, decision) is saved for the team.',
    },
    ar: {
      when: 'إدارة الشركة: عقود، ميزانيات، تعيينات، سناتر.',
      target: 'قبل معاد التسليم.',
      steps: ['اتفق على النتيجة المطلوبة والمعاد', 'حدد المطلوب ومين هيعمله', '!نفّذ', 'بلّغ الناس المعنيين', '!سجّله في مكان الفريق يلاقيه'],
      done: 'اتعمل، والتوثيق (عقد، شيت، قرار) محفوظ للفريق.',
    },
  },

  // Online platform
  content_upload: {
    en: {
      when: 'Putting a lesson, PDF or homework on the platform.',
      target: 'Live by 8 pm on the scheduled day.',
      steps: ['!Get the final, approved files from the content team (video, PDF, quiz)', 'Check the video plays, and the sound and captions', '!Upload to the right course, unit and lesson', 'Set the title, description and order', '!Set the publish date and who can see it', '!Open it as a student and check it works', 'Tell Customer Service and the teacher it is live'],
      done: 'Students can open it on the scheduled day, and CS and the teacher know.',
    },
    ar: {
      when: 'رفع درس أو PDF أو واجب على المنصة.',
      target: 'يبقى منشور قبل 8 بالليل في يومه المحدد.',
      steps: ['!استلم الملفات النهائية المعتمدة من فريق المحتوى (فيديو، PDF، أسئلة)', 'اتأكد إن الفيديو شغال والصوت والترجمة سليمين', '!ارفع على الكورس والوحدة والدرس الصح', 'اكتب العنوان والوصف وحدد الترتيب', '!حدد معاد النشر ومين يقدر يشوفه', '!افتحه بحساب طالب واتأكد إنه شغال', 'بلّغ خدمة العملاء والمستر إنه اتنشر'],
      done: 'الطلبة يقدروا يفتحوه في يومه، وخدمة العملاء والمستر عارفين.',
    },
  },
  platform_exam: {
    en: {
      when: 'Putting an exam or quiz on the platform.',
      target: 'Ready and tested a day before it opens.',
      steps: ['!Get the approved exam and answer key', '!Enter the questions and the correct answers', '!Set the time limit, attempts and opening window', 'Choose the students or groups it is for', '!Take it once as a test student', 'Publish it and announce it', 'Watch for problems while it is open'],
      done: 'The exam opened on time with no wrong answers in the key.',
    },
    ar: {
      when: 'رفع امتحان أو كويز على المنصة.',
      target: 'جاهز ومتجرّب قبل فتحه بيوم.',
      steps: ['!استلم الامتحان المعتمد ونموذج الإجابة', '!ادخل الأسئلة والإجابات الصح', '!حدد الوقت وعدد المحاولات ومعاد الفتح والقفل', 'اختار الطلبة أو المجموعات', '!جرّبه مرة بحساب طالب تجريبي', 'انشره واعلن عنه', 'تابع أي مشاكل وهو مفتوح'],
      done: 'الامتحان اتفتح في معاده ومفيش إجابات غلط في النموذج.',
    },
  },
  exam_results: {
    en: {
      when: 'An exam on the platform has closed.',
      target: 'Results out within 3 days of closing.',
      steps: ['Close the exam at the deadline', '!Check the automatic marks', 'Send the essay questions for grading', '!Publish the results to the students', '!Share the report (averages, top students, hardest questions) with the teacher'],
      done: 'Students have their results and the teacher has the report.',
    },
    ar: {
      when: 'امتحان على المنصة اتقفل.',
      target: 'النتايج تنزل خلال 3 أيام من القفل.',
      steps: ['اقفل الامتحان في معاده', '!راجع التصحيح الأوتوماتيك', 'ابعت الأسئلة المقالية للتصحيح', '!انشر النتايج للطلبة', '!ابعت التقرير (المتوسط، الأوائل، أصعب الأسئلة) للمستر'],
      done: 'الطلبة عرفوا نتايجهم والمستر استلم التقرير.',
    },
  },
  forum_moderation: {
    en: {
      when: 'Looking after the course forums (daily).',
      target: 'Every new post seen within 24 hours.',
      steps: ['Read the new posts and replies', '!Remove anything breaking the forum rules', 'Answer general questions about the platform', '!Pass subject questions to the academic team', 'Pin useful answers', 'Note recurring problems for the product owner'],
      done: 'No post older than a day without a reply or a hand-off.',
    },
    ar: {
      when: 'متابعة منتديات الكورسات (يوميًا).',
      target: 'أي بوست جديد يتشاف خلال 24 ساعة.',
      steps: ['اقرأ البوستات والردود الجديدة', '!امسح أي حاجة مخالفة لقواعد المنتدى', 'رد على الأسئلة العامة عن المنصة', '!حوّل الأسئلة العلمية لفريق المادة العلمية', 'ثبّت الإجابات المفيدة', 'سجّل المشاكل المتكررة لمالك المنتج'],
      done: 'مفيش بوست عدّى عليه يوم من غير رد أو تحويل.',
    },
  },
  complaint: {
    en: {
      when: 'A student or parent complains about anything.',
      target: 'Acknowledge within 24 hours; resolve within 3 days.',
      steps: ['!Record who complained, how to reach them and what happened', '!Reply within 24 hours that it is being handled', 'Find the cause (bug, content, payment, staff)', 'Fix it or pass it to the team responsible', '!Tell the student what was done', '!Confirm the student is satisfied'],
      done: 'The student was told what was done and is satisfied, or the reason they are not is written down.',
    },
    ar: {
      when: 'طالب أو ولي أمر اشتكى من أي حاجة.',
      target: 'الرد بالاستلام خلال 24 ساعة، والحل خلال 3 أيام.',
      steps: ['!سجّل مين اشتكى ورقم تواصله وإيه اللي حصل', '!رد خلال 24 ساعة إن الشكوى بتتحل', 'حدد السبب (خلل، محتوى، دفع، موظف)', 'حلّها أو حوّلها للفريق المسؤول', '!بلّغ الطالب باللي اتعمل', '!اتأكد إن الطالب راضي'],
      done: 'الطالب اتبلّغ باللي اتعمل وراضي، أو سبب عدم رضاه مكتوب.',
    },
  },

  // Academic Material
  hw_grading: {
    en: {
      when: 'Students hand in homework at the center; it is graded on the spot.',
      target: 'Graded and back with the students before they leave the class.',
      steps: ['!Collect the homework from the students', '!Grade it on the model answer', '!Write down the common wrong answers', '!Enter each student’s mark in the system', '!Hand the homework back to each student, stamped on the cover', '!Send the common wrong answers and questions to the Head of Academic Material'],
      done: 'Every homework is graded, stamped and back with its student, every mark is in the system, and the common mistakes are with the Head of Academic Material.',
    },
    ar: {
      when: 'الطلبة بيسلّموا الواجب في السنتر، وبيتصحح في ساعتها.',
      target: 'يتصحح ويرجع للطلبة قبل ما يمشوا من الحصة.',
      steps: ['!استلم الواجب من الطلبة', '!صحّح على نموذج الإجابة', '!سجّل الإجابات الغلط المتكررة', '!سجّل درجة كل طالب على السيستم', '!رجّع الواجب لكل طالب مختوم على الغلاف', '!ابعت الإجابات الغلط والأسئلة المتكررة لرئيس المادة العلمية'],
      done: 'كل واجب اتصحح واتختم ورجع لصاحبه، وكل الدرجات على السيستم، والأخطاء المتكررة وصلت لرئيس المادة العلمية.',
    },
  },
  exam_proctoring: {
    en: {
      when: 'Supervising an exam at a center.',
      target: 'In the hall before the exam starts.',
      steps: ['!Go into the exam hall before the start', '!Take the section the head of the halls assigns you', '!Proctor your section without leaving it', '!Collect your section’s papers', '!Hand the papers to the head of the halls'],
      done: 'Your section was proctored and all its papers are with the head of the halls.',
    },
    ar: {
      when: 'مراقبة امتحان في سنتر.',
      target: 'في القاعة قبل بداية الامتحان.',
      steps: ['!ادخل القاعة قبل بداية الامتحان', '!استلم القسم اللي رئيس القاعات يحددهولك', '!راقب القسم بتاعك من غير ما تسيبه', '!اجمع ورق القسم بتاعك', '!سلّم الورق لرئيس القاعات'],
      done: 'القسم بتاعك اتراقب، وكل ورقه مع رئيس القاعات.',
    },
  },
  exam_grading: {
    en: {
      when: 'Exam papers from a center need grading.',
      target: 'Marks in the sheet within 3 days of the exam.',
      steps: ['!Get the exam papers and the model answer', '!Grade every paper on the model answer', 'Second-check a sample of papers', '!Enter the marks in the sheet', 'Report the top students and the most missed questions'],
      done: 'Every paper is graded, a sample double-checked, and the marks are in the sheet.',
    },
    ar: {
      when: 'ورق امتحان من سنتر محتاج تصحيح.',
      target: 'الدرجات في الشيت خلال 3 أيام من الامتحان.',
      steps: ['!استلم ورق الامتحان ونموذج الإجابة', '!صحّح كل الورق على النموذج', 'راجع عينة من الورق مرة تانية', '!ادخل الدرجات في الشيت', 'بلّغ بأوائل الطلبة وأكتر أسئلة غلط فيها الطلبة'],
      done: 'كل الورق اتصحح، وعينة اتراجعت، والدرجات في الشيت.',
    },
  },
  center_questions: {
    en: {
      when: 'Taking students’ questions at a center.',
      target: 'Unanswered questions answered within 48 hours.',
      steps: ['!Be at the center at the agreed time', 'Answer the students’ questions', '!Write down questions you could not answer', 'Get the answers from the teacher', '!Send the answers back to those students'],
      done: 'Every question asked has an answer.',
    },
    ar: {
      when: 'استقبال أسئلة الطلبة في السنتر.',
      target: 'الأسئلة اللي متجاوبتش تتجاوب خلال 48 ساعة.',
      steps: ['!احضر السنتر في المعاد المتفق عليه', 'جاوب على أسئلة الطلبة', '!سجّل الأسئلة اللي معرفتش تجاوبها', 'خد إجابتها من المستر', '!ابعت الإجابة للطلبة دول'],
      done: 'كل سؤال اتسأل ليه إجابة.',
    },
  },
  exam_papers: {
    en: {
      when: 'Writing a new exam (center or platform).',
      target: 'Sent for review a week before the exam.',
      steps: ['!Agree the lessons and the number of models', '!Write the questions (easy, medium and hard)', '!Make model A and model B', 'Check the time needed and the marks', 'Format the paper', '!Send it for review'],
      done: 'Both models approved and ready to print or upload.',
    },
    ar: {
      when: 'كتابة امتحان جديد (سنتر أو منصة).',
      target: 'يتبعت للمراجعة قبل الامتحان بأسبوع.',
      steps: ['!اتفق على الدروس وعدد النماذج', '!اكتب الأسئلة (سهل ومتوسط وصعب)', '!اعمل نموذج A ونموذج B', 'راجع الوقت والدرجات', 'نسّق الورقة', '!ابعتها للمراجعة'],
      done: 'النموذجين اتعتمدوا وجاهزين للطباعة أو الرفع.',
    },
  },
  exam_answers: {
    en: {
      when: 'An exam needs its model answer.',
      target: 'Ready with the exam, before it is printed.',
      steps: ['!Solve every question in full', '!Write the mark scheme for each question', 'Note the alternative correct answers', 'Format the answer sheet', '!Send it for review'],
      done: 'The approved answers and mark scheme are with the graders.',
    },
    ar: {
      when: 'امتحان محتاج نموذج إجابة.',
      target: 'جاهز مع الامتحان قبل الطباعة.',
      steps: ['!حل كل الأسئلة بالتفصيل', '!اكتب توزيع الدرجات لكل سؤال', 'سجّل الإجابات الصحيحة التانية المقبولة', 'نسّق ورقة الإجابة', '!ابعتها للمراجعة'],
      done: 'الإجابات وتوزيع الدرجات المعتمدين مع المصححين.',
    },
  },
  model_answer_review: {
    en: {
      when: 'A model answer was written and needs a second person.',
      target: 'Within 24 hours of receiving it.',
      steps: ['!Solve the exam yourself without looking', '!Compare with the model answer', 'Check units, numbers and the mark scheme', 'Write the corrections', '!Approve the final version'],
      done: 'The final model answer is approved with every correction made.',
    },
    ar: {
      when: 'مودل أنسر اتكتب ومحتاج حد تاني يراجعه.',
      target: 'خلال 24 ساعة من استلامه.',
      steps: ['!حل الامتحان بنفسك من غير ما تبص على الإجابة', '!قارن بالمودل أنسر', 'راجع الوحدات والأرقام وتوزيع الدرجات', 'اكتب التصحيحات', '!اعتمد النسخة النهائية'],
      done: 'المودل أنسر النهائي اتعتمد وكل التصحيحات اتعملت.',
    },
  },
  hw_model_answer: {
    en: {
      when: 'A homework needs its model answer (one per track: Azhar / General).',
      target: 'Ready the day the homework is given.',
      steps: ['!Choose the track: Azhar or General', '!Solve every question in full', 'Add short explanations where students usually go wrong', 'Format it', '!Send it for review'],
      done: 'An approved model answer for each track is with the graders.',
    },
    ar: {
      when: 'واجب محتاج نموذج إجابة (واحد لكل مسار: أزهر / عام).',
      target: 'جاهز يوم ما الواجب يتدّي.',
      steps: ['!حدد المسار: أزهر أو عام', '!حل كل الأسئلة بالتفصيل', 'زوّد شرح بسيط في الأماكن اللي الطلبة بتغلط فيها', 'نسّقه', '!ابعته للمراجعة'],
      done: 'نموذج إجابة معتمد لكل مسار مع المصححين.',
    },
  },
  answer_key_review: {
    en: {
      when: 'A homework model answer needs checking.',
      target: 'Within 24 hours of receiving it.',
      steps: ['!Solve the questions yourself', '!Compare with the answer key', '!Check the track (Azhar / General) matches', 'Write the corrections', '!Approve the final version'],
      done: 'The answer key is approved for the right track.',
    },
    ar: {
      when: 'نموذج إجابة واجب محتاج مراجعة.',
      target: 'خلال 24 ساعة من استلامه.',
      steps: ['!حل الأسئلة بنفسك', '!قارن بنموذج الإجابة', '!اتأكد إن المسار (أزهر / عام) صح', 'اكتب التصحيحات', '!اعتمد النسخة النهائية'],
      done: 'نموذج الإجابة اتعتمد للمسار الصح.',
    },
  },
  platform_questions: {
    en: {
      when: 'Students’ questions waiting on the platform.',
      target: 'Every question answered within 24 hours.',
      steps: ['Open the questions waiting on the platform', '!Reply within 24 hours', 'Send hard questions to the teacher', 'Note questions that repeat', '!Close the answered questions'],
      done: 'No question older than 24 hours without an answer.',
    },
    ar: {
      when: 'أسئلة طلبة مستنية على المنصة.',
      target: 'كل سؤال يتجاوب خلال 24 ساعة.',
      steps: ['افتح الأسئلة المستنية على المنصة', '!رد خلال 24 ساعة', 'ابعت الأسئلة الصعبة للمستر', 'سجّل الأسئلة اللي بتتكرر', '!قفّل الأسئلة اللي اتجاوبت'],
      done: 'مفيش سؤال عدّى عليه 24 ساعة من غير إجابة.',
    },
  },
  essay_grading: {
    en: {
      when: 'Essay answers on the platform need grading.',
      target: 'Within 3 days of the exam closing.',
      steps: ['Open the essay answers on the platform', '!Grade on the model answer', 'Write short feedback for each student', '!Publish the marks', 'Report the common mistakes to the teacher'],
      done: 'Every essay is graded and the marks are published.',
    },
    ar: {
      when: 'إجابات مقالية على المنصة محتاجة تصحيح.',
      target: 'خلال 3 أيام من قفل الامتحان.',
      steps: ['افتح الإجابات المقالية على المنصة', '!صحّح على نموذج الإجابة', 'اكتب ملاحظة قصيرة لكل طالب', '!انشر الدرجات', 'بلّغ المستر بالأخطاء المتكررة'],
      done: 'كل الإجابات المقالية اتصححت والدرجات اتنشرت.',
    },
  },
  weekly_duties: {
    en: {
      when: 'Every week, for every assistant (created automatically on Saturday).',
      target: 'By Friday.',
      steps: ['!Solve external book 1', '!Solve external book 2', '!Solve external book 3', '!Solve the teacher’s book', '!Solve the exam', '!Attend the class'],
      done: 'Everything solved and the class attended; the Head of Academic Material approved it.',
    },
    ar: {
      when: 'كل أسبوع، لكل أسيستنت (بتتعمل لوحدها يوم السبت).',
      target: 'قبل الجمعة.',
      steps: ['!حل الكتاب الخارجي الأول', '!حل الكتاب الخارجي الثاني', '!حل الكتاب الخارجي الثالث', '!حل كتاب المستر', '!حل الامتحان', '!حضور الحصة'],
      done: 'كله اتحل والحصة اتحضرت، ورئيس المادة العلمية وافق.',
    },
  },
};

// A step written as "!text" is required.
const step = (s) => (typeof s === 'string' ? (s.startsWith('!') ? { text: s.slice(1).trim(), required: true } : { text: s, required: false }) : { text: String(s.text), required: !!s.required });

// Built-in SOPs with their steps as { text, required }.
export const SOPS = Object.fromEntries(
  Object.entries(BUILT_IN).map(([type, langs]) => [type, Object.fromEntries(Object.entries(langs).map(([lang, sop]) => [lang, { ...sop, steps: sop.steps.map(step) }]))]),
);

// A stored (custom) SOP in the current shape: older ones were a list of step texts.
export function normaliseSop(value) {
  const sop = Array.isArray(value) ? { steps: value } : value || {};
  return { when: sop.when || '', target: sop.target || '', done: sop.done || '', steps: (sop.steps || []).map(step).filter((s) => s.text) };
}

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

// A type's SOP: the custom version if a manager set one, else the built-in one in `lang`.
export function sopFor(type, lang, custom) {
  if (custom?.[type]) return normaliseSop(custom[type]);
  return SOPS[type]?.[lang === 'ar' ? 'ar' : 'en'] ?? { when: '', target: '', done: '', steps: [] };
}

export const sopSteps = (type, lang, custom) => sopFor(type, lang, custom).steps;
