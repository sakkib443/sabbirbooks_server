/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * seed-medical.ts — Seeds realistic MEDICAL test data (categories, mentors,
 * courses, books) into Sabbir Book by calling the live admin HTTP API. This
 * doubles as an end-to-end test of the create endpoints.
 *
 * Run (server must already be running on :5000):
 *   cd server && npx ts-node --transpile-only src/scripts/seed-medical.ts
 *
 * It is IDEMPOTENT — re-running skips anything that already exists (by category
 * name, mentor id, course title, book slug) instead of crashing on duplicates.
 *
 * Notes / API quirks this script works around (see report):
 *  - Every image field is validated with zod .url(), so relative paths like
 *    "/images/x.jpg" are REJECTED — we use https placeholders.
 *  - Course `id` is NOT auto-generated (unlike category/book); we compute the
 *    next free numeric id ourselves.
 *  - Categories have no duplicate-name guard, so we pre-check by name.
 *  - Master admin logs in as `superAdmin`, which bypasses all authorize() gates.
 */

const BASE = process.env.SEED_API_BASE || 'http://localhost:5000';
const DEVICE_ID = 'seed-script-device';
const ADMIN = { email: 'admin@sabbirbook.com', password: 'Admin@123456' };

// Placeholder assets (all must be valid URLs to pass zod .url()).
const IMG_SQUARE = 'https://placehold.co/400x400';
const IMG_COURSE = 'https://placehold.co/800x450';
const IMG_COVER = 'https://placehold.co/400x600';
const PDF_PREVIEW = 'https://example.com/preview/sample.pdf';

type ApiRes = { status: number; ok: boolean; body: any };

async function api(
  method: string,
  path: string,
  opts: { token?: string; body?: any } = {},
): Promise<ApiRes> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'x-device-id': DEVICE_ID,
  };
  if (opts.token) headers['Authorization'] = `Bearer ${opts.token}`;
  const res = await fetch(BASE + path, {
    method,
    headers,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  let body: any = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  return { status: res.status, ok: res.ok, body };
}

const isDuplicate = (msg: string) =>
  /already exists|duplicate|e11000/i.test(String(msg || ''));

const slugify = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');

// ─── Seed data ───────────────────────────────────────────────

const CATEGORIES = [
  'Anatomy',
  'Physiology',
  'Biochemistry',
  'Pharmacology',
  'Pathology',
  'Microbiology',
  'Community Medicine',
  'Forensic Medicine',
];

const MENTORS = [
  {
    id: 'sbb-mentor-001',
    name: 'Dr. Rahim Uddin',
    email: 'rahim.uddin@sabbirbook.com',
    phone: '+8801711000001',
    designation: 'Associate Professor of Anatomy',
    subject: 'Anatomy',
    specialized_area: ['Gross Anatomy', 'Histology', 'Embryology'],
    education_qualification: [
      'MBBS, Dhaka Medical College',
      'M.Phil in Anatomy, BSMMU',
    ],
    work_experience: [
      '12+ years teaching first-year MBBS anatomy',
      'Former Demonstrator, Sir Salimullah Medical College',
    ],
    training_experience: { years: '12', students: '4500' },
    image: IMG_SQUARE,
    details:
      'Dr. Rahim Uddin is a seasoned anatomy educator known for simplifying gross anatomy and histology for first-year MBBS students through structured dissection and 3D visualisation.',
    lifeJourney:
      'Rising from a small district town to one of the country’s most sought-after anatomy teachers, Dr. Rahim has mentored thousands of medical students over more than a decade.',
  },
  {
    id: 'sbb-mentor-002',
    name: 'Dr. Ayesha Siddiqua',
    email: 'ayesha.siddiqua@sabbirbook.com',
    phone: '+8801711000002',
    designation: 'Assistant Professor of Pharmacology',
    subject: 'Pharmacology',
    specialized_area: ['Clinical Pharmacology', 'Therapeutics', 'Toxicology'],
    education_qualification: [
      'MBBS, Chittagong Medical College',
      'MD in Pharmacology, BSMMU',
    ],
    work_experience: [
      '9+ years teaching pharmacology and therapeutics',
      'Clinical pharmacologist and question-bank author',
    ],
    training_experience: { years: '9', students: '3200' },
    image: IMG_SQUARE,
    details:
      'Dr. Ayesha Siddiqua specialises in clinical pharmacology and therapeutics, turning a traditionally memorisation-heavy subject into concept-driven, exam-focused learning.',
    lifeJourney:
      'A first-generation doctor in her family, Dr. Ayesha combines bedside clinical insight with a passion for teaching drug mechanisms in a way students actually remember.',
  },
];

// mentorIdx → index into MENTORS after creation; category → category name.
const COURSES = [
  {
    title: 'First Year MBBS: Anatomy Foundation',
    category: 'Anatomy',
    mentorIdx: 0,
    type: 'Online' as const,
    fee: '8000',
    offerPrice: '5500',
    admissionFee: 2000,
    technology: 'Gross Anatomy & Histology',
    lectures: 48,
    durationMonth: 6,
    courseStart: '2026-08-01',
    curriculum: [
      'Introduction to Anatomy & Anatomical Terms',
      'Upper Limb & Lower Limb',
      'Thorax and Abdomen',
      'Head, Neck & Neuroanatomy basics',
      'General Histology & Embryology',
    ],
    softwareYoullLearn: ['Complete Anatomy 3D', 'Anki Flashcards'],
    jobPositions: ['Medical Officer', 'Anatomy Demonstrator', 'Resident Doctor'],
    details:
      'A complete first-year MBBS anatomy foundation course covering gross anatomy, histology and embryology with live problem-solving sessions.',
    courseOverview:
      'Build a rock-solid anatomy base for professional exams with dissection walkthroughs, spotters practice and weekly assessments.',
  },
  {
    title: 'Pharmacology Made Easy',
    category: 'Pharmacology',
    mentorIdx: 1,
    type: 'Recorded' as const,
    fee: '6000',
    offerPrice: '4000',
    admissionFee: 0,
    technology: 'Clinical Pharmacology',
    lectures: 40,
    curriculum: [
      'General Pharmacology & Pharmacokinetics',
      'Autonomic Nervous System drugs',
      'Cardiovascular & Renal pharmacology',
      'Antimicrobials & Chemotherapy',
      'CNS drugs and Autacoids',
    ],
    softwareYoullLearn: ['Drug Interaction Checker', 'Anki Flashcards'],
    jobPositions: ['Medical Officer', 'Clinical Pharmacologist'],
    details:
      'A recorded, concept-first pharmacology course that replaces rote memorisation with mechanism-based understanding and high-yield mnemonics.',
    courseOverview:
      'Master second-year pharmacology at your own pace with organised drug classifications, mechanism diagrams and exam-oriented recaps.',
  },
  {
    title: 'Pathology Rapid Revision',
    category: 'Pathology',
    mentorIdx: 1,
    type: 'Recorded' as const,
    fee: '5000',
    offerPrice: '3500',
    admissionFee: 0,
    technology: 'General & Systemic Pathology',
    lectures: 36,
    curriculum: [
      'Cell injury, Inflammation & Repair',
      'Haemodynamic disorders & Neoplasia',
      'Systemic Pathology overview',
      'Clinical Pathology & Slides',
    ],
    softwareYoullLearn: ['Virtual Microscopy Atlas', 'Anki Flashcards'],
    jobPositions: ['Medical Officer', 'Pathology Resident'],
    details:
      'A fast-paced recorded revision course designed for last-minute pathology preparation before professional and admission exams.',
    courseOverview:
      'Revise the entire pathology syllabus quickly with slide spotters, one-liners and high-yield tables curated for exams.',
  },
  {
    title: 'Physiology Crash Course',
    category: 'Physiology',
    mentorIdx: 0,
    type: 'Online' as const,
    fee: '7000',
    offerPrice: '4800',
    admissionFee: 1500,
    technology: 'Human Physiology',
    lectures: 44,
    durationMonth: 4,
    courseStart: '2026-08-15',
    curriculum: [
      'General & Nerve-Muscle Physiology',
      'Cardiovascular & Respiratory systems',
      'Renal, GIT & Endocrine physiology',
      'CNS & Special senses',
    ],
    softwareYoullLearn: ['Physiology Simulator', 'Anki Flashcards'],
    jobPositions: ['Medical Officer', 'Physiology Demonstrator'],
    details:
      'An intensive live crash course covering the entire first-year physiology syllabus with weekly quizzes and doubt-clearing classes.',
    courseOverview:
      'Cover cardiovascular, respiratory, renal and CNS physiology in a structured live crash course built for professional exams.',
  },
  {
    title: 'Biochemistry Essentials',
    category: 'Biochemistry',
    mentorIdx: 1,
    type: 'Recorded' as const,
    fee: '5500',
    offerPrice: '3800',
    admissionFee: 0,
    technology: 'Medical Biochemistry',
    lectures: 38,
    curriculum: [
      'Biomolecules & Enzymes',
      'Carbohydrate, Lipid & Protein metabolism',
      'Vitamins, Minerals & Nutrition',
      'Molecular biology & Clinical biochemistry',
    ],
    softwareYoullLearn: ['Metabolic Pathway Maps', 'Anki Flashcards'],
    jobPositions: ['Medical Officer', 'Biochemistry Demonstrator'],
    details:
      'A recorded biochemistry course that connects metabolic pathways to clinical scenarios so concepts stick for the long term.',
    courseOverview:
      'Understand metabolism, enzymes and molecular biology through clear pathway maps and clinically-linked explanations.',
  },
  {
    title: 'Microbiology & Immunology Masterclass',
    category: 'Microbiology',
    mentorIdx: 0,
    type: 'Online' as const,
    fee: '7500',
    offerPrice: '5000',
    admissionFee: 1500,
    technology: 'Medical Microbiology',
    lectures: 42,
    durationMonth: 5,
    courseStart: '2026-09-01',
    curriculum: [
      'General Bacteriology & Immunology',
      'Systemic Bacteriology',
      'Virology & Mycology',
      'Parasitology & Applied Microbiology',
    ],
    softwareYoullLearn: ['Gram Stain Atlas', 'Anki Flashcards'],
    jobPositions: ['Medical Officer', 'Microbiology Resident'],
    details:
      'A live masterclass covering bacteriology, virology, immunology and parasitology with clinical case correlations.',
    courseOverview:
      'Connect microbes to disease with systematic bacteriology, immunology fundamentals and applied clinical microbiology.',
  },
];

const BOOKS = [
  {
    title: 'Anatomy Question Bank',
    author: 'Dr. Rahim Uddin',
    category: 'Anatomy',
    format: 'printed' as const,
    price: 650,
    offerPrice: 520,
    stock: 120,
    language: 'both' as const,
    isFeatured: true,
    description:
      'A comprehensive, topic-wise anatomy question bank with previous years’ professional and admission questions plus model answers.',
  },
  {
    title: 'Guyton Physiology Companion',
    author: 'Dr. Ayesha Siddiqua',
    category: 'Physiology',
    format: 'digital' as const,
    price: 400,
    offerPrice: 300,
    secureFileUrl: 'https://example.com/secure/guyton-physiology-companion.pdf',
    language: 'en' as const,
    isFeatured: true,
    description:
      'A concise digital companion to Guyton & Hall physiology with summarised chapters, flowcharts and high-yield points for quick revision.',
  },
  {
    title: 'Clinical Pharmacology Notes',
    author: 'Dr. Ayesha Siddiqua',
    category: 'Pharmacology',
    format: 'digital' as const,
    price: 350,
    offerPrice: 250,
    secureFileUrl: 'https://example.com/secure/clinical-pharmacology-notes.pdf',
    language: 'both' as const,
    isFeatured: false,
    description:
      'Ready-to-revise clinical pharmacology notes organised by drug class, with mechanisms, indications, adverse effects and exam pointers.',
  },
  {
    title: 'Pathology MCQ Bank',
    author: 'Dr. Sabbir Ahmed',
    category: 'Pathology',
    format: 'printed' as const,
    price: 700,
    offerPrice: 560,
    stock: 80,
    language: 'both' as const,
    isFeatured: false,
    description:
      'Over 2000 single-best-answer pathology MCQs with detailed explanations covering general and systemic pathology.',
  },
  {
    title: 'Biochemistry Made Simple',
    author: 'Dr. Nusrat Jahan',
    category: 'Biochemistry',
    format: 'printed' as const,
    price: 550,
    offerPrice: 440,
    stock: 150,
    language: 'bn' as const,
    isFeatured: false,
    description:
      'A student-friendly biochemistry guide in accessible language, simplifying metabolism and molecular biology with diagrams.',
  },
  {
    title: 'Microbiology Quick Notes',
    author: 'Dr. Rahim Uddin',
    category: 'Microbiology',
    format: 'digital' as const,
    price: 300,
    offerPrice: 220,
    secureFileUrl: 'https://example.com/secure/microbiology-quick-notes.pdf',
    language: 'both' as const,
    isFeatured: true,
    description:
      'Fast, high-yield microbiology notes covering bacteriology, virology and parasitology, ideal for last-minute exam revision.',
  },
];

const COURSE_INCLUDES = [
  { icon: 'video', text: 'HD recorded video lectures' },
  { icon: 'file', text: 'Downloadable PDF notes' },
  { icon: 'quiz', text: 'Chapter-wise MCQ tests' },
  { icon: 'support', text: 'Doubt-solving support' },
];

// ─── Runner ──────────────────────────────────────────────────

async function main() {
  const summary = {
    categories: { created: 0, skipped: 0, failed: 0 },
    mentors: { created: 0, skipped: 0, failed: 0 },
    courses: { created: 0, skipped: 0, failed: 0 },
    books: { created: 0, skipped: 0, failed: 0 },
  };
  const issues: string[] = [];

  console.log(`\n=== Seeding medical data → ${BASE} ===\n`);

  // 1) LOGIN ------------------------------------------------------------------
  const login = await api('POST', '/api/auth/login', { body: ADMIN });
  if (!login.ok || !login.body?.data?.accessToken) {
    console.error('LOGIN FAILED:', login.status, JSON.stringify(login.body));
    throw new Error('Cannot continue without admin token');
  }
  const token = login.body.data.accessToken as string;
  console.log(
    `[auth] Logged in as ${login.body.data.user?.role} (${ADMIN.email}) — token acquired.\n`,
  );

  // 2) CATEGORIES -------------------------------------------------------------
  const existingCats = await api('GET', '/api/categories');
  const catByName = new Map<string, string>(); // name(lower) → _id
  for (const c of existingCats.body?.data || []) {
    catByName.set(String(c.name).toLowerCase(), c._id);
  }
  for (const name of CATEGORIES) {
    if (catByName.has(name.toLowerCase())) {
      summary.categories.skipped++;
      console.log(`[category] skip (exists): ${name}`);
      continue;
    }
    const res = await api('POST', '/api/categories/create-category', {
      token,
      body: { name },
    });
    if (res.status === 201 && res.body?.data?._id) {
      catByName.set(name.toLowerCase(), res.body.data._id);
      summary.categories.created++;
      console.log(`[category] created: ${name} (id ${res.body.data.id})`);
    } else {
      summary.categories.failed++;
      const m = res.body?.message || res.status;
      issues.push(`category "${name}" → ${m}`);
      console.log(`[category] FAILED: ${name} → ${m}`);
    }
  }

  // 3) MENTORS ----------------------------------------------------------------
  const existingMentors = await api('GET', '/api/mentors');
  const mentorById = new Map<string, string>(); // business id → _id
  for (const m of existingMentors.body?.data || []) {
    mentorById.set(String(m.id), m._id);
  }
  const mentorObjectIds: string[] = []; // aligned with MENTORS index
  for (const mentor of MENTORS) {
    if (mentorById.has(mentor.id)) {
      mentorObjectIds.push(mentorById.get(mentor.id)!);
      summary.mentors.skipped++;
      console.log(`[mentor] skip (exists): ${mentor.name} (${mentor.id})`);
      continue;
    }
    const res = await api('POST', '/api/mentors/create-mentor', {
      token,
      body: mentor,
    });
    if (res.status === 201 && res.body?.data?._id) {
      mentorObjectIds.push(res.body.data._id);
      mentorById.set(mentor.id, res.body.data._id);
      summary.mentors.created++;
      console.log(`[mentor] created: ${mentor.name} (${mentor.id})`);
    } else if (isDuplicate(res.body?.message)) {
      // Race / partial prior run — refetch to grab its _id.
      const refetch = await api('GET', `/api/mentors/${mentor.id}`);
      const oid = refetch.body?.data?._id;
      if (oid) mentorObjectIds.push(oid);
      summary.mentors.skipped++;
      console.log(`[mentor] skip (dup): ${mentor.name} → ${res.body?.message}`);
    } else {
      summary.mentors.failed++;
      const m = res.body?.message || res.status;
      issues.push(`mentor "${mentor.name}" → ${m}`);
      console.log(`[mentor] FAILED: ${mentor.name} → ${m}`);
    }
  }
  if (mentorObjectIds.length === 0) {
    throw new Error('No mentors available — courses require a mentor ref. Aborting course seed.');
  }

  // 4) COURSES ----------------------------------------------------------------
  // Course `id` is NOT auto-generated — compute next free numeric id ourselves.
  const allCourses = await api('GET', '/api/courses?status=all&limit=500');
  const courseTitles = new Set<string>(
    (allCourses.body?.data || []).map((c: any) => String(c.title).toLowerCase()),
  );
  let nextCourseId =
    (allCourses.body?.data || []).reduce(
      (max: number, c: any) => Math.max(max, Number(c.id) || 0),
      0,
    ) + 1;

  for (const c of COURSES) {
    if (courseTitles.has(c.title.toLowerCase())) {
      summary.courses.skipped++;
      console.log(`[course] skip (exists): ${c.title}`);
      continue;
    }
    const categoryId = catByName.get(c.category.toLowerCase());
    if (!categoryId) {
      summary.courses.failed++;
      issues.push(`course "${c.title}" → missing category "${c.category}"`);
      console.log(`[course] FAILED: ${c.title} → missing category ${c.category}`);
      continue;
    }
    const mentorId = mentorObjectIds[c.mentorIdx % mentorObjectIds.length];

    const payload: any = {
      id: nextCourseId,
      title: c.title,
      slug: slugify(c.title),
      category: categoryId,
      type: c.type,
      status: 'published',
      image: IMG_COURSE,
      fee: c.fee,
      offerPrice: c.offerPrice,
      admissionFee: c.admissionFee,
      mentor: mentorId,
      technology: c.technology,
      lectures: c.lectures,
      totalExam: 8,
      totalProject: 0,
      curriculum: c.curriculum,
      details: c.details,
      courseOverview: c.courseOverview,
      courseIncludes: COURSE_INCLUDES,
      softwareYoullLearn: c.softwareYoullLearn,
      jobPositions: c.jobPositions,
    };
    // Live (Online/Offline) courses require courseStart + durationMonth.
    if (c.type !== 'Recorded') {
      payload.courseStart = (c as any).courseStart;
      payload.durationMonth = (c as any).durationMonth;
    }

    const res = await api('POST', '/api/courses/create-course', {
      token,
      body: payload,
    });
    if (res.status === 201 && res.body?.data?._id) {
      summary.courses.created++;
      nextCourseId++;
      console.log(
        `[course] created: ${c.title} (id ${payload.id}, ${c.type}) → ${c.category}`,
      );
    } else if (isDuplicate(res.body?.message)) {
      summary.courses.skipped++;
      nextCourseId++;
      console.log(`[course] skip (dup): ${c.title} → ${res.body?.message}`);
    } else {
      summary.courses.failed++;
      const m = res.body?.message || res.status;
      issues.push(`course "${c.title}" → ${m}`);
      console.log(`[course] FAILED: ${c.title} → ${JSON.stringify(res.body)}`);
    }
  }

  // 5) BOOKS ------------------------------------------------------------------
  const allBooks = await api('GET', '/api/books?status=all&limit=500');
  const bookSlugs = new Set<string>(
    (allBooks.body?.data || []).map((b: any) => String(b.slug)),
  );
  for (const b of BOOKS) {
    const slug = slugify(b.title);
    if (bookSlugs.has(slug)) {
      summary.books.skipped++;
      console.log(`[book] skip (exists): ${b.title}`);
      continue;
    }
    const payload: any = {
      title: b.title,
      slug,
      author: b.author,
      description: b.description,
      coverImage: IMG_COVER,
      price: b.price,
      offerPrice: b.offerPrice,
      category: b.category,
      language: b.language,
      format: b.format,
      status: 'published',
      isFeatured: b.isFeatured,
      previewImages: [IMG_COVER],
      previewPdfUrl: PDF_PREVIEW,
    };
    if (b.format === 'printed') payload.stock = (b as any).stock;
    if (b.format === 'digital') payload.secureFileUrl = (b as any).secureFileUrl;

    const res = await api('POST', '/api/books', { token, body: payload });
    if (res.status === 201 && res.body?.data?._id) {
      summary.books.created++;
      console.log(
        `[book] created: ${b.title} (id ${res.body.data.id}, ${b.format})`,
      );
    } else if (isDuplicate(res.body?.message)) {
      summary.books.skipped++;
      console.log(`[book] skip (dup): ${b.title} → ${res.body?.message}`);
    } else {
      summary.books.failed++;
      const m = res.body?.message || res.status;
      issues.push(`book "${b.title}" → ${m}`);
      console.log(`[book] FAILED: ${b.title} → ${JSON.stringify(res.body)}`);
    }
  }

  // 6) VERIFY via public GET endpoints ---------------------------------------
  console.log('\n=== Verify public GET endpoints ===');
  const vCats = await api('GET', '/api/categories');
  const vCourses = await api('GET', '/api/courses');
  const vBooks = await api('GET', '/api/books');
  const vMentors = await api('GET', '/api/mentors');

  const catList = vCats.body?.data || [];
  const courseList = vCourses.body?.data || [];
  const bookList = vBooks.body?.data || [];
  const mentorList = vMentors.body?.data || [];

  console.log(
    `GET /api/categories → ${catList.length} items; sample: "${catList[0]?.name ?? 'n/a'}"`,
  );
  console.log(
    `GET /api/courses    → ${courseList.length} items (meta.total=${vCourses.body?.meta?.total}); sample: "${courseList[0]?.title ?? 'n/a'}"`,
  );
  console.log(
    `GET /api/books      → ${bookList.length} items (meta.total=${vBooks.body?.meta?.total}); sample: "${bookList[0]?.title ?? 'n/a'}"`,
  );
  console.log(
    `GET /api/mentors    → ${mentorList.length} items; sample: "${mentorList[0]?.name ?? 'n/a'}"`,
  );

  // 7) SUMMARY ---------------------------------------------------------------
  console.log('\n=== Seed summary (created / skipped / failed) ===');
  for (const [k, v] of Object.entries(summary)) {
    console.log(`  ${k.padEnd(12)}: ${v.created} / ${v.skipped} / ${v.failed}`);
  }
  if (issues.length) {
    console.log('\n=== Issues encountered ===');
    issues.forEach((i) => console.log(`  - ${i}`));
  } else {
    console.log('\nNo unexpected issues.');
  }
  console.log('\nDone.\n');
}

main().catch((err) => {
  console.error('\nFATAL:', err?.message || err);
  process.exit(1);
});
