interface CareerImage {
  src: string;
  alt: string;
  caption: string;
  source: string;
  width: number;
  height: number;
}

interface CareerChapter {
  id: string;
  company: string;
  period: string;
  shortPeriod: string;
  role: string;
  website: string;
  focus: string;
  paragraphs: string[];
  highlights?: { title: string; text: string }[];
  roles?: { title: string; period: string }[];
  image?: CareerImage;
  preview?: {
    video: string;
    poster: string;
    description: string;
  };
}

// Career dates and wording: supplied LinkedIn Profile.pdf, pp. 1–2.
// Spellbook detail: 2024 self-review p. 4; 2025 manager review p. 2;
// 2026 self-review pp. 6–7 and peer review p. 9. Private review packets
// stay outside the repository; unrelated personal feedback is omitted.
export const career: CareerChapter[] = [
  {
    id: "spellbook",
    company: "Spellbook",
    period: "January 2024 — Present",
    shortPeriod: "2024 — Now",
    role: "Senior Software Engineer",
    website: "https://spellbook.com/",
    focus: "AI-native legal tools",
    // Public Associate animation: https://spellbook.com/associate (2.4–11.6s).
    preview: {
      video: "/experience/spellbook-preview.mp4",
      poster: "/experience/spellbook-preview.webp",
      description: "AI tools for drafting, reviewing, and working with legal documents.",
    },
    paragraphs: [
      "I built and led Spellbook Associate, an AI legal agent for lawyers. I took the product from prototype to a team of 6 engineers, leading work across agentic workflows, legal document understanding, DOCX editing, Word integration, redlining, and multi-step contract workflows.",
      // review_packet (1).pdf, p. 4: July 2024–June 2025 self-review.
      // These are Associate product outcomes, not company-wide or personally generated revenue.
      // Preserve the source's approximate figures; it does not identify a currency denomination.
      // Mitchell's October 27, 2026 update: now millions in ARR and core to the product offering.
      "By mid-2025, Associate had reached hundreds of daily active users and contributed hundreds of thousands of dollars in annual recurring revenue. That work now sits at the core of Spellbook’s product offering, contributing millions in ARR.",
      "More recently, I designed and scaled an intake and triage system for a contracts pipeline: a generic intake system for email, Slack, Salesforce, and wherever else deals start. My work spans reviewing and redlining contracts, storing signed agreements, and making that history searchable with answers cited back to the source.",
    ],
    highlights: [
      {
        title: "From prototype to product",
        text: "My goal joining Spellbook was to become a more product-focused developer. I integrated customer feedback directly into the product, worked closely with the product team, and built foundational features across the Word add-in, contract review, and legal drafting experience.",
      },
      {
        title: "The foundation of Repository",
        // review_packet (3).pdf, p. 2: manager's account of the prototype timeline.
        text: "I shipped a working Repository prototype in days. I built the OneDrive integration from scratch: authentication, file picker, sync, sidebar, and analytics. I designed and shipped the document ingestion pipeline end to end, and built fair-queue scheduling so a large customer batch can’t starve everyone else.",
      },
      {
        title: "A reliable, helpful AI agent for law",
        // review_packet (3).pdf, p. 6: personal ticket count over the preceding 12 months.
        text: "I moved the chat backend onto the Vercel AI SDK, unlocked resumable streams, and kept improving the editing agent. I also resolved 100+ support tickets in the year leading up to Q2 2026. Alongside the technical work, I helped teammates get up to speed, supported engineering decisions, and kept the team focused on the next most important thing.",
      },
    ],
    roles: [
      { title: "Senior Software Engineer", period: "Aug 2026 — Present" },
      {
        title: "Lead Software Engineer · Team Associate",
        period: "Jul 2025 — Present",
      },
      {
        title: "Intermediate Full-Stack Engineer",
        period: "Jan 2024 — Jul 2025",
      },
    ],
    image: {
      src: "/experience/spellbook-associate.webp",
      alt: "Spellbook Associate with an AI conversation beside a contract showing tracked edits.",
      caption: "Associate · Contract editing and review",
      source: "https://help.spellbook.legal/en/articles/10438652-associate-overview",
      width: 1120,
      height: 640,
    },
  },
  {
    id: "jungle-scout",
    company: "Jungle Scout",
    period: "March 2023 — December 2023",
    shortPeriod: "2023",
    role: "Software Developer",
    website: "https://www.junglescout.com/",
    focus: "Growth & monetization",
    // Official demo: https://www.youtube.com/watch?v=ToOWCdLjl0A (6:50–6:57).
    preview: {
      video: "/experience/jungle-scout-preview.mp4",
      poster: "/experience/jungle-scout-preview.webp",
      description: "Product research and business tools for Amazon sellers.",
    },
    paragraphs: [
      "I built growth and monetization experiments for a large ecommerce SaaS product. I shipped payment and onboarding experiences, analyzed deep PostgreSQL/Rails data flows, and contributed experiments that drove measurable revenue growth.",
    ],
  },
  {
    id: "siftmed",
    company: "SiftMed",
    period: "August 2021 — March 2023",
    shortPeriod: "2021 — 2023",
    role: "Software Developer",
    website: "https://www.siftmed.ca/",
    focus: "Medical document intelligence",
    // Screen recording of https://www.siftmed.ca/product, not a private app session.
    preview: {
      video: "/experience/siftmed-preview.mp4",
      poster: "/experience/siftmed-preview.webp",
      description: "Medical document intelligence for reviewing complex records.",
    },
    paragraphs: [
      "I built backend and ML infrastructure for a medical document intelligence product, including multi-tenant systems, AWS Lambda deployments, and Terraform infrastructure. I also coached developers internally.",
    ],
  },
  {
    id: "colab",
    company: "CoLab Software",
    period: "June 2019 — August 2021",
    shortPeriod: "2019 — 2021",
    role: "Full Stack Developer",
    website: "https://www.colabsoftware.com/",
    focus: "Foundations for design review",
    // Public CoLab homepage demo: AutoReview/virtualreview.mp4 (14.65–20.4s).
    preview: {
      video: "/experience/colab-preview.mp4",
      poster: "/experience/colab-preview.webp",
      description: "Design review and collaboration around 3D models and engineering drawings.",
    },
    paragraphs: ["I built foundational features at CoLab that are still used today."],
    highlights: [
      {
        title: "A component library, from scratch",
        text: "I crafted a component library from scratch using Storybook, TypeScript, and CSS Modules.",
      },
      {
        title: "Moving to React & GraphQL",
        text: "I played a big role in replacing the existing jQuery and server-rendered application with React and GraphQL.",
      },
    ],
    image: {
      src: "/experience/colab-design-review.webp",
      alt: "CoLab’s design review interface with a 3D mechanical assembly and a panel of review comments.",
      caption: "CoLab · 3D design review and feedback",
      source: "https://help.colabsoftware.com/en/articles/11970380-introduction-to-feedback",
      width: 1394,
      height: 832,
    },
  },
  {
    id: "memorial",
    company: "Memorial University",
    period: "December 2018 — February 2019",
    shortPeriod: "2018 — 2019",
    role: "Full Stack Developer",
    website: "https://www.mun.ca/",
    focus: "An international fisheries database",
    paragraphs: [
      "I maintained an international fisheries database at Memorial University of Newfoundland, working with Python, PostgreSQL, and jQuery.",
    ],
  },
];
