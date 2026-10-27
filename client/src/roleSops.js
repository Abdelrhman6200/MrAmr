// Role SOPs: what each role is for and how it works, day to day and week to
// week, including how it uses TaskFlow. Built-in versions; the people who
// manage a team can replace their roles' SOPs from the SOPs page (stored in
// the sops table under "role:<role>"). Shared by the web app and the server.
//
// Per language: purpose, daily, weekly, system (in TaskFlow) and escalate.

export const ROLE_SOPS = {
  ceo: {
    en: {
      purpose: 'Sets the direction of the company and makes sure every department delivers.',
      daily: ['Check your dashboard: what is overdue, blocked or waiting for your decision', 'Decide the reviews and approvals waiting on you', 'Follow up any urgent complaint or platform outage'],
      weekly: ['Meet the department heads; go through Reports together', 'Check each team’s workload and overdue work on the dashboard', 'Approve budgets, hires and contracts raised to you'],
      system: ['Reports shows progress by department, status and priority', 'You see every task and project; use filters rather than asking for updates', 'Name a deputy under Team → Cover before you travel'],
      escalate: 'Board / owners.',
    },
    ar: {
      purpose: 'بيحدد اتجاه الشركة وبيتأكد إن كل قسم بيسلّم المطلوب منه.',
      daily: ['شوف الرئيسية: المتأخر والمتوقف واللي مستني قرارك', 'خلّص المراجعات والموافقات اللي مستنياك', 'تابع أي شكوى عاجلة أو عطل في المنصة'],
      weekly: ['اجتماع مع رؤساء الأقسام ومراجعة التقارير مع بعض', 'راجع ضغط الشغل والمتأخر عند كل فريق من الرئيسية', 'وافق على الميزانيات والتعيينات والعقود المرفوعة لك'],
      system: ['التقارير بتوريك التقدم حسب القسم والحالة والأولوية', 'إنت شايف كل المهام والمشاريع؛ استخدم الفلاتر بدل ما تسأل عن التحديثات', 'حدد نائب من الفريق ← التغطية قبل أي سفر'],
      escalate: 'مجلس الإدارة / الملاك.',
    },
  },
  ops_manager: {
    en: {
      purpose: 'Runs the day-to-day operation: centers, people, schedules and the processes between teams.',
      daily: ['Check the centers schedule for today and any gaps', 'Clear blocked tasks across operations and content', 'Answer requests from the department heads'],
      weekly: ['Open or close availability rounds with the Head of Content', 'Review the SOPs that are often late (SOPs page stats) and fix them with their owners', 'Check new and leaving staff: accounts, managers, handovers'],
      system: ['Users: create accounts, set managers and roles', 'Centers: centers, rounds and the weekly schedule', 'Team → Cover: deputies and handing over work'],
      escalate: 'Head of Company.',
    },
    ar: {
      purpose: 'بيدير التشغيل اليومي: السناتر والناس والجداول والإجراءات بين الفرق.',
      daily: ['راجع جدول السناتر النهارده وأي نقص فيه', 'حل المهام المتوقفة في العمليات والمحتوى', 'رد على طلبات رؤساء الأقسام'],
      weekly: ['افتح أو اقفل جولات التوافر مع رئيس قسم المحتوى', 'راجع الإجراءات اللي بتتأخر كتير (أرقام صفحة الإجراءات) وظبطها مع أصحابها', 'تابع الموظفين الجداد واللي ماشيين: الحسابات والمديرين وتسليم الشغل'],
      system: ['المستخدمون: إنشاء الحسابات وتحديد المديرين والأدوار', 'المراكز: السناتر وجولات التوافر والجدول الأسبوعي', 'الفريق ← التغطية: النواب وتسليم الشغل'],
      escalate: 'رئيس الشركة.',
    },
  },
  head_of_content: {
    en: {
      purpose: 'Owns the courses: what gets recorded, by whom, when, and to what standard.',
      daily: ['Check the lessons in progress and anything blocked', 'Approve scripts sent to you', 'Answer instructors’ questions'],
      weekly: ['Plan next week’s recordings per course and assign them', 'Check Content Quality’s rejections and why', 'Build the centers schedule from the instructors’ availability'],
      system: ['Create a project per course; add instructors and Content Quality to it', 'Create lessons as Content Creation tasks with Content Quality as reviewer', 'Centers → Availability to ask for and remind about availability'],
      escalate: 'Operations Manager.',
    },
    ar: {
      purpose: 'مسؤول عن الكورسات: إيه اللي يتسجل، ومين يسجله، وإمتى، وبأي مستوى.',
      daily: ['تابع الدروس اللي شغالة وأي حاجة متوقفة', 'وافق على السكريبتات اللي اتبعتتلك', 'رد على أسئلة المدرسين'],
      weekly: ['خطط تسجيلات الأسبوع الجاي لكل كورس ووزّعها', 'راجع رفض جودة المحتوى وأسبابه', 'اعمل جدول السناتر من توافر المدرسين'],
      system: ['اعمل مشروع لكل كورس وضيف فيه المدرسين وجودة المحتوى', 'اعمل الدروس كمهام "إنتاج محتوى" والمراجع جودة المحتوى', 'المراكز ← التوافر لطلب التوافر والتذكير بيه'],
      escalate: 'مدير العمليات.',
    },
  },
  media_producer: {
    en: {
      purpose: 'Films and edits: lessons for the courses, and photos and videos for marketing.',
      daily: ['Check your shoots and edits for today', 'Back up yesterday’s footage if it isn’t yet', 'Send finished edits for review'],
      weekly: ['Agree next week’s shoots with the Head of Content and Marketing', 'Check the equipment and order what is missing', 'Clean up and organise the footage folders'],
      system: ['Filming and Video editing tasks follow their SOPs; backups and review are required steps', 'Lessons are reviewed by Content Quality, promos by the Marketing Manager', 'Mark a task Blocked if you are waiting for a script or a teacher'],
      escalate: 'Head of Content (and the Marketing Manager for marketing work).',
    },
    ar: {
      purpose: 'بيصوّر ويعمل مونتاج: دروس الكورسات، وصور وفيديوهات التسويق.',
      daily: ['شوف التصوير والمونتاج المطلوب النهارده', 'خزّن تصوير امبارح لو لسه متخزنش', 'ابعت المونتاج اللي خلص للمراجعة'],
      weekly: ['اتفق على تصوير الأسبوع الجاي مع رئيس قسم المحتوى والتسويق', 'راجع المعدات واطلب الناقص', 'رتّب فولدرات التصوير'],
      system: ['مهام "تصوير" و"مونتاج" ماشية على الـ SOP بتاعها، والتخزين والمراجعة خطوات مطلوبة', 'الدروس بتراجعها جودة المحتوى، والدعاية بيراجعها مدير التسويق', 'خلّي المهمة "متوقفة" لو مستني سكريبت أو مستر'],
      escalate: 'رئيس قسم المحتوى (ومدير التسويق في شغل التسويق).',
    },
  },
  instructor: {
    en: {
      purpose: 'Teaches: records the lessons and teaches the classes at the centers.',
      daily: ['Check your tasks for today on the dashboard', 'Tick the checklist as you go; comment when something is blocked', 'Teach your center sessions on time'],
      weekly: ['Send your center availability when a round is open', 'Send finished lessons to review; fix what Content Quality asks', 'Look at the common mistakes the assistants send you'],
      system: ['Your lessons come with their SOP steps; the required ones must be ticked before review', 'Centers → My availability for your weekly slots', 'Mark a task Blocked and say why, rather than waiting'],
      escalate: 'Head of Content.',
    },
    ar: {
      purpose: 'بيدرّس: بيسجل الدروس وبيدّي الحصص في السناتر.',
      daily: ['شوف مهام النهارده من الرئيسية', 'علّم على قائمة المراجعة وإنت شغال، واكتب تعليق لو حاجة وقفت', 'ادّي حصص السنتر في معادها'],
      weekly: ['ابعت توافرك للسناتر لما الجولة تتفتح', 'ابعت الدروس اللي خلصت للمراجعة وعدّل اللي جودة المحتوى تطلبه', 'شوف الأخطاء المتكررة اللي الأسيستنتس بيبعتوها'],
      system: ['دروسك جاية بخطوات الـ SOP، والمطلوب منها لازم يتعلّم قبل المراجعة', 'المراكز ← توافري لمواعيدك الأسبوعية', 'خلّي المهمة "متوقفة" واكتب السبب بدل ما تستنى'],
      escalate: 'رئيس قسم المحتوى.',
    },
  },
  academic_head: {
    en: {
      purpose: 'Leads the assistants: homework, exams, model answers and students’ questions, at the centers and on the platform.',
      daily: ['Check what the assistants are doing today and who is at which center', 'Review model answers and exam papers sent to you', 'Collect the common mistakes and pass them to the teacher'],
      weekly: ['Approve each assistant’s weekly duties (books, teacher’s book, exam, class)', 'Plan the week’s grading, proctoring and question sessions and assign them', 'Check the platform questions and essays are answered on time'],
      system: ['Weekly duties are created every Saturday; you approve them', 'Use the track tags (General, Azhar, Baccalaureate) on every task', 'You can change the Academic Material SOPs on the SOPs page'],
      escalate: 'Head of Company (or the teacher for subject questions).',
    },
    ar: {
      purpose: 'بيقود الأسيستنتس: الواجبات والامتحانات ونماذج الإجابة وأسئلة الطلبة، في السناتر وعلى المنصة.',
      daily: ['تابع الأسيستنتس بيعملوا إيه النهارده ومين في أنهي سنتر', 'راجع نماذج الإجابة وورق الامتحانات اللي اتبعتتلك', 'اجمع الأخطاء المتكررة وابعتها للمستر'],
      weekly: ['وافق على المهام الأسبوعية لكل أسيستنت (الكتب، كتاب المستر، الامتحان، الحصة)', 'خطط التصحيح والمراقبة واستقبال الأسئلة للأسبوع ووزّعها', 'اتأكد إن أسئلة المنصة والمقالي بتتجاوب في معادها'],
      system: ['المهام الأسبوعية بتتعمل كل سبت، وإنت اللي بتوافق عليها', 'استخدم وسوم المسار (عام، أزهر، بكالوريا) في كل مهمة', 'تقدر تعدّل إجراءات المادة العلمية من صفحة الإجراءات'],
      escalate: 'رئيس الشركة (أو المستر في الأسئلة العلمية).',
    },
  },
  assistant: {
    en: {
      purpose: 'Supports the teacher and the students: grading, proctoring, answers and questions.',
      daily: ['Check your tasks and where you are needed today', 'Follow each task’s SOP; tick the required steps', 'Answer the students’ questions on time (platform: within 24 hours)'],
      weekly: ['Do your weekly duties: 3 external books, the teacher’s book, the exam, attend the class', 'Send the weekly duties to review by Friday', 'Send the common mistakes to the Head of Academic Material'],
      system: ['Your weekly duties task appears every Saturday', 'Pick the right track (General / Azhar / Baccalaureate) on model answers', 'Can’t finish? Comment and mark the task Blocked'],
      escalate: 'Head of Academic Material.',
    },
    ar: {
      purpose: 'بيساعد المستر والطلبة: تصحيح ومراقبة وإجابات وأسئلة.',
      daily: ['شوف مهامك ومطلوب منك تكون فين النهارده', 'امشي على الـ SOP بتاع كل مهمة وعلّم على الخطوات المطلوبة', 'جاوب أسئلة الطلبة في معادها (المنصة: خلال 24 ساعة)'],
      weekly: ['خلّص مهامك الأسبوعية: 3 كتب خارجية، كتاب المستر، الامتحان، حضور الحصة', 'ابعت المهام الأسبوعية للمراجعة قبل الجمعة', 'ابعت الأخطاء المتكررة لرئيس المادة العلمية'],
      system: ['مهمة المهام الأسبوعية بتظهرلك كل سبت', 'اختار المسار الصح (عام / أزهر / بكالوريا) في نماذج الإجابة', 'مش هتلحق؟ اكتب تعليق وخلّي المهمة "متوقفة"'],
      escalate: 'رئيس المادة العلمية.',
    },
  },
  halls_head: {
    en: {
      purpose: 'Runs the exam halls at the centers: seating, proctors, papers.',
      daily: ['On exam days: prepare the halls an hour early', 'Give each proctor their section and watch the halls', 'Count the papers against attendance and hand them to the graders'],
      weekly: ['Agree the coming exams, halls and proctors with the Head of Academic Material', 'Check the attendance sheets and seating plans are ready'],
      system: ['Running the exam halls tasks follow their SOP; counting the papers is required', 'Proctors have Exam proctoring tasks; check they are assigned before the day'],
      escalate: 'Head of Academic Material.',
    },
    ar: {
      purpose: 'بيدير قاعات الامتحانات في السناتر: الأماكن والمراقبين والورق.',
      daily: ['أيام الامتحانات: جهّز القاعات قبلها بساعة', 'وزّع على كل مراقب القسم بتاعه وتابع القاعات', 'عدّ الورق على الحضور وسلّمه للمصححين'],
      weekly: ['اتفق مع رئيس المادة العلمية على الامتحانات الجاية والقاعات والمراقبين', 'اتأكد إن كشوف الحضور وتوزيع الأماكن جاهزين'],
      system: ['مهام "إدارة قاعات الامتحان" ماشية على الـ SOP، وعدّ الورق خطوة مطلوبة', 'المراقبين ليهم مهام "مراقبة في الامتحان"، اتأكد إنها متوزعة قبل اليوم'],
      escalate: 'رئيس المادة العلمية.',
    },
  },
  marketing_manager: {
    en: {
      purpose: 'Brings in students: plans campaigns, owns the budget and reports results.',
      daily: ['Check the campaigns running and their numbers', 'Approve copy and designs waiting on you', 'Unblock your team'],
      weekly: ['Plan next week’s posts and campaigns and assign them', 'Report results (reach, leads, cost per lead) to the Head of Company', 'Agree with Content what to promote'],
      system: ['A project per campaign; tasks of type Marketing Campaign', 'Be the reviewer on anything that goes public', 'Attach results in the campaign task’s comments'],
      escalate: 'Head of Company.',
    },
    ar: {
      purpose: 'بيجيب الطلبة: بيخطط الحملات، ومسؤول عن الميزانية، وبيعمل تقارير النتايج.',
      daily: ['تابع الحملات الشغالة وأرقامها', 'وافق على الكلام والتصميمات المستنياك', 'حل اللي موقف فريقك'],
      weekly: ['خطط بوستات وحملات الأسبوع الجاي ووزّعها', 'ابعت النتايج (الوصول، العملاء المحتملين، تكلفة العميل) لرئيس الشركة', 'اتفق مع المحتوى على اللي هيتروّج له'],
      system: ['مشروع لكل حملة، ومهام نوعها "حملة تسويقية"', 'خلّي نفسك المراجع على أي حاجة هتتنشر', 'حط النتايج في تعليقات مهمة الحملة'],
      escalate: 'رئيس الشركة.',
    },
  },
  marketing_member: {
    en: {
      purpose: 'Makes the marketing: copy, designs, posts and ads.',
      daily: ['Work on your campaign tasks; tick the checklist', 'Reply to comments and messages on the pages', 'Send finished work to the Marketing Manager for review'],
      weekly: ['Prepare next week’s posts', 'Share what worked with the team'],
      system: ['Each campaign task has its SOP; the approval step is required', 'Nothing goes public without the manager’s approval in TaskFlow'],
      escalate: 'Marketing Manager.',
    },
    ar: {
      purpose: 'بيعمل التسويق: الكلام والتصميمات والبوستات والإعلانات.',
      daily: ['اشتغل على مهام الحملات وعلّم على قائمة المراجعة', 'رد على التعليقات والرسايل على الصفحات', 'ابعت الشغل اللي خلص لمدير التسويق يراجعه'],
      weekly: ['جهّز بوستات الأسبوع الجاي', 'شارك الفريق اللي نجح'],
      system: ['كل مهمة حملة ليها SOP، وخطوة الموافقة مطلوبة', 'مفيش حاجة تتنشر من غير موافقة المدير على TaskFlow'],
      escalate: 'مدير التسويق.',
    },
  },
  sysops_manager: {
    en: {
      purpose: 'Keeps systems and quality running: the platform’s technical side, backups and the quality checks.',
      daily: ['Check urgent bugs and anything students are blocked by', 'Check backups and storage', 'Unblock Content Quality and Ops QC'],
      weekly: ['Plan quality audits of published content', 'Review open bugs with the Product Owner'],
      system: ['Bugs come to you as Platform Bug tasks; follow the bug SOP', 'Use the Q4-style audit project for planned checks'],
      escalate: 'Head of Company.',
    },
    ar: {
      purpose: 'بيحافظ على الأنظمة والجودة شغالين: الجانب التقني للمنصة، والنسخ الاحتياطي، وفحوصات الجودة.',
      daily: ['تابع الأعطال العاجلة وأي حاجة موقفة الطلبة', 'اتأكد من النسخ الاحتياطي والتخزين', 'حل اللي موقف جودة المحتوى ومراقبة الجودة'],
      weekly: ['خطط فحوصات جودة المحتوى المنشور', 'راجع الأعطال المفتوحة مع مالك المنتج'],
      system: ['الأعطال بتوصلك كمهام "خلل في المنصة"، امشي على الـ SOP بتاعها', 'استخدم مشروع الفحص للمراجعات المخططة'],
      escalate: 'رئيس الشركة.',
    },
  },
  content_quality: {
    en: {
      purpose: 'Makes sure every lesson is accurate and well made before students see it.',
      daily: ['Review the lessons waiting for you (they come first on your dashboard)', 'Approve, or request changes with numbered notes'],
      weekly: ['Spot-check published lessons', 'Share the common problems with the Head of Content'],
      system: ['Use Approve / Request changes on the task; a reason is needed for changes', 'Within 2 working days of a lesson arriving'],
      escalate: 'Systems Operations Lead.',
    },
    ar: {
      purpose: 'بيتأكد إن كل درس صح ومعمول كويس قبل ما الطلبة تشوفه.',
      daily: ['راجع الدروس المستنياك (بتظهر أول حاجة في الرئيسية)', 'وافق، أو اطلب تعديلات بملاحظات مترقّمة'],
      weekly: ['افحص عينة من الدروس المنشورة', 'ابعت المشاكل المتكررة لرئيس قسم المحتوى'],
      system: ['استخدم "موافقة / طلب تعديلات" في المهمة، والتعديلات لازم يتكتب سببها', 'خلال يومين شغل من وصول الدرس'],
      escalate: 'مسؤول عمليات الأنظمة.',
    },
  },
  ops_qc: {
    en: {
      purpose: 'Checks the operation works as it should: processes, releases and the platform.',
      daily: ['Run the checks assigned to you', 'Report each problem to its owner with screenshots'],
      weekly: ['Re-check the problems that were fixed', 'Test releases before they go live'],
      system: ['QC Check tasks follow their SOP; report findings in comments', 'Be the reviewer on bug fixes'],
      escalate: 'Systems Operations Lead.',
    },
    ar: {
      purpose: 'بيتأكد إن التشغيل ماشي صح: الإجراءات والإصدارات والمنصة.',
      daily: ['نفّذ الفحوصات المطلوبة منك', 'بلّغ كل مشكلة لصاحبها ومعاها صور'],
      weekly: ['راجع تاني المشاكل اللي اتصلحت', 'اختبر الإصدارات قبل ما تنزل'],
      system: ['مهام "فحص جودة" ماشية على الـ SOP بتاعها، والملاحظات في التعليقات', 'خلّي نفسك المراجع على تصليح الأعطال'],
      escalate: 'مسؤول عمليات الأنظمة.',
    },
  },
  cs_head: {
    en: {
      purpose: 'Leads Customer Service: every student and parent gets a quick, correct answer, and the call lists get done.',
      daily: ['Check the calls stats: who is behind, call-backs due', 'Upload and split today’s call sheets', 'Handle escalated complaints'],
      weekly: ['Review each agent’s and team leader’s numbers', 'Send the top student problems to Product and Content', 'Check complaints are closed within 3 days'],
      system: ['Calls: upload sheets, split them, follow progress per agent', 'Team → Cover: name a deputy before leave; hand over an absent agent’s work', 'Raise platform problems as Platform Bug tasks to the Product Owner'],
      escalate: 'Head of Company.',
    },
    ar: {
      purpose: 'بيقود خدمة العملاء: كل طالب وولي أمر ياخد رد سريع وصح، وقوايم المكالمات تخلص.',
      daily: ['شوف إحصائيات المكالمات: مين متأخر ومعاودات الاتصال المستحقة', 'ارفع شيتات النهارده ووزّعها', 'اتعامل مع الشكاوى المصعّدة'],
      weekly: ['راجع أرقام كل موظف وكل قائد فريق', 'ابعت أكتر مشاكل الطلبة للمنتج والمحتوى', 'اتأكد إن الشكاوى بتتقفل خلال 3 أيام'],
      system: ['المكالمات: ارفع الشيتات ووزّعها وتابع كل موظف', 'الفريق ← التغطية: حدد نائب قبل الإجازة، وسلّم شغل الموظف الغايب', 'المشاكل التقنية ترفعها كمهام "خلل في المنصة" لمالك المنتج'],
      escalate: 'رئيس الشركة.',
    },
  },
  cs_team_lead: {
    en: {
      purpose: 'Runs a Customer Service team day to day: their calls, their quality and their training.',
      daily: ['Start the day checking your agents’ open calls and call-backs due', 'Split new calls between your agents', 'Help with hard calls and complaints; listen in on a few calls'],
      weekly: ['Score 5 recorded calls per agent', 'Train new agents on the scripts', 'Report your team’s numbers to the Head of Customer Service'],
      system: ['Calls → lists and stats for your agents', 'Act for the Head of Customer Service when named as deputy (Team → Cover)', 'Hand over an absent agent’s calls to a colleague the same morning'],
      escalate: 'Head of Customer Service.',
    },
    ar: {
      purpose: 'بيدير فريق خدمة عملاء يوميًا: مكالماتهم وجودتها وتدريبهم.',
      daily: ['ابدأ اليوم بمكالمات فريقك المفتوحة ومعاودات الاتصال المستحقة', 'وزّع المكالمات الجديدة على فريقك', 'ساعد في المكالمات والشكاوى الصعبة، واسمع شوية مكالمات'],
      weekly: ['قيّم 5 مكالمات متسجلة لكل موظف', 'درّب الموظفين الجداد على السكريبتات', 'ابعت أرقام فريقك لرئيس خدمة العملاء'],
      system: ['المكالمات ← القوايم والإحصائيات لفريقك', 'لما تتحدد نائب لرئيس خدمة العملاء بتنوب عنه (الفريق ← التغطية)', 'سلّم مكالمات الموظف الغايب لزميله من الصبح'],
      escalate: 'رئيس خدمة العملاء.',
    },
  },
  cs_member: {
    en: {
      purpose: 'Talks to students and parents: calls, questions and complaints, quickly and politely.',
      daily: ['Open My calls: call-backs due first, then the rest', 'Log the outcome of every call with a short note', 'Record complaints as Student complaint tasks'],
      weekly: ['Clear your call list before the week ends', 'Tell your team leader about repeated problems'],
      system: ['Tap the number to call; then choose the outcome', 'Call back later needs a time, so it comes back to you', 'Support tasks follow their SOP: reply within 4 working hours'],
      escalate: 'Customer Service Team Leader, then the Head of Customer Service.',
    },
    ar: {
      purpose: 'بيتكلم مع الطلبة وأولياء الأمور: مكالمات وأسئلة وشكاوى، بسرعة وبأدب.',
      daily: ['افتح "مكالماتي": معاودات الاتصال المستحقة الأول وبعدين الباقي', 'سجّل نتيجة كل مكالمة بملاحظة قصيرة', 'سجّل الشكاوى كمهام "شكوى طالب"'],
      weekly: ['خلّص قايمة مكالماتك قبل آخر الأسبوع', 'بلّغ قائد فريقك بالمشاكل المتكررة'],
      system: ['دوس على الرقم عشان تتصل، وبعدين اختار النتيجة', '"معاودة الاتصال لاحقًا" محتاجة معاد عشان ترجعلك', 'مهام الدعم ماشية على الـ SOP: الرد خلال 4 ساعات شغل'],
      escalate: 'قائد فريق خدمة العملاء، وبعده رئيس خدمة العملاء.',
    },
  },
  product_owner: {
    en: {
      purpose: 'Owns the online platform: what gets published and when, how many students use it, and how far they get.',
      daily: ['Check the Platform page: what is due to publish today, open complaints, urgent bugs', 'Make sure today’s uploads and exams went live on time', 'Unblock the platform team', 'Decide new requests: now, later or no'],
      weekly: ['Plan the publishing timeline with the content team: every lesson and exam has a date and an owner', 'Enter the week’s numbers (users, active, sessions, progress) from the platform dashboard', 'Import each course’s progress; send students who are behind or away to Customer Service', 'Review exams going up and their results', 'Review complaints and bugs by cause; fix the biggest one'],
      system: ['Platform → Publishing timeline: uploads and exams by week; Plan uploads turns a content plan into dated tasks', 'Platform → Users & progress: weekly numbers with trends, course progress, and Send to Customer Service for a call list', 'Each platform task type has its SOP; change them for your team on the SOPs page', 'Customer Service raises bugs and complaints to you'],
      escalate: 'Head of Company.',
    },
    ar: {
      purpose: 'مسؤول عن المنصة الإلكترونية: إيه اللي بيتنشر وإمتى، كام طالب بيستخدمها، ووصلوا لفين.',
      daily: ['شوف صفحة المنصة: المطلوب نشره النهارده، والشكاوى المفتوحة، والأعطال العاجلة', 'اتأكد إن رفعات وامتحانات النهارده نزلت في معادها', 'حل اللي موقف فريق المنصة', 'قرر في الطلبات الجديدة: دلوقتي، بعدين، ولا لأ'],
      weekly: ['خطط جدول النشر مع فريق المحتوى: كل درس وامتحان ليه معاد ومسؤول', 'دخّل أرقام الأسبوع (المستخدمين، النشطين، الجلسات، التقدم) من لوحة المنصة', 'استورد تقدم كل كورس، وابعت الطلبة المتأخرين أو الغايبين لخدمة العملاء', 'راجع الامتحانات اللي هتنزل ونتايجها', 'راجع الشكاوى والأعطال حسب السبب وحل أكبرها'],
      system: ['المنصة ← جدول النشر: الرفعات والامتحانات بالأسبوع، وخطة الرفع بتحوّل خطة المحتوى لمهام بمواعيدها', 'المنصة ← المستخدمين والتقدم: أرقام الأسبوع واتجاهها، وتقدم الكورسات، وزرار "ابعت لخدمة العملاء" لقائمة مكالمات', 'كل نوع مهمة على المنصة ليه SOP، وتقدر تعدّلها لفريقك من صفحة الإجراءات', 'خدمة العملاء بترفعلك الأعطال والشكاوى'],
      escalate: 'رئيس الشركة.',
    },
  },
  platform_member: {
    en: {
      purpose: 'Runs the platform day to day: uploads, exams, forums and complaints.',
      daily: ['Do today’s uploads on the schedule, checking each as a student', 'Read the forums; answer or pass questions on', 'Work your complaints: reply within 24 hours'],
      weekly: ['Prepare and test the exams opening next week', 'Publish results of closed exams', 'Tell the Product Owner about problems that keep coming back'],
      system: ['Platform page: your uploads, exams, forums and complaints in one place', 'Required SOP steps (like testing as a student) must be ticked before done'],
      escalate: 'Product Owner.',
    },
    ar: {
      purpose: 'بيشغّل المنصة يوميًا: الرفع والامتحانات والمنتديات والشكاوى.',
      daily: ['ارفع المطلوب النهارده حسب الجدول، وافتح كل حاجة بحساب طالب', 'اقرأ المنتديات وجاوب أو حوّل الأسئلة', 'اشتغل على شكاويك: الرد خلال 24 ساعة'],
      weekly: ['جهّز واختبر امتحانات الأسبوع الجاي', 'انشر نتايج الامتحانات اللي اتقفلت', 'بلّغ مالك المنتج بالمشاكل اللي بتتكرر'],
      system: ['صفحة المنصة: الرفع والامتحانات والمنتديات والشكاوى في مكان واحد', 'خطوات الـ SOP المطلوبة (زي التجربة بحساب طالب) لازم تتعلّم قبل القفل'],
      escalate: 'مالك المنتج.',
    },
  },
};

const lines = (v, max = 20) => (Array.isArray(v) ? v : String(v || '').split('\n')).map((s) => String(s).trim().slice(0, 300)).filter(Boolean).slice(0, max);

// A stored (custom) role SOP, cleaned.
export const normaliseRoleSop = (v = {}) => ({
  purpose: String(v.purpose || '').trim().slice(0, 500),
  daily: lines(v.daily),
  weekly: lines(v.weekly),
  system: lines(v.system),
  escalate: String(v.escalate || '').trim().slice(0, 300),
});

// The SOP for `role`: the custom one if set, else the built-in one in `lang`.
export function roleSopFor(role, lang, custom) {
  const own = custom?.[`role:${role}`];
  if (own) return normaliseRoleSop(own);
  return ROLE_SOPS[role]?.[lang === 'ar' ? 'ar' : 'en'] ?? normaliseRoleSop();
}

// Who changes a role's SOP: user admins and the Head of Company for any role;
// a manager for the roles in their own department; a team leader for their own
// role and the members' roles there.
export function canEditRoleSop(roles, adminRoles, userRole, role) {
  if (userRole === 'ceo' || adminRoles.includes(userRole)) return true;
  const me = roles[userRole];
  const target = roles[role];
  if (!me || !target || me.level === 'member' || target.department !== me.department) return false;
  return !me.lead || role === userRole || target.level === 'member';
}
