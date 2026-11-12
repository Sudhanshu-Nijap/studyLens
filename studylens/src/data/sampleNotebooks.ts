import {
  sampleMaterials,
  sampleMessages,
  samplePreviews,
  sampleQuiz,
} from "@/data/fixtures";
import type {
  Material,
  QuizQuestion,
  SourcePreview,
  StudyConversation,
  StudyNotebook,
  StudyUser,
} from "@/types";

export type NotebookContent = {
  materials: Material[];
  conversations: StudyConversation[];
  previews: Record<string, SourcePreview>;
  quiz?: QuizQuestion;
};

export const previewViewer: StudyUser = {
  id: "preview-student",
  displayName: "StudyLens Student",
};

export const sampleNotebooks: StudyNotebook[] = [
  {
    id: "algorithms-dsa",
    title: "Algorithms & DSA",
    description: "Graph traversal, complexity, and revision notes",
    createdAt: "2026-09-18T10:00:00.000Z",
    updatedAt: "2026-10-01T12:00:00.000Z",
  },
  {
    id: "database-systems",
    title: "Database Systems",
    description: "Indexes, queries, and database design",
    createdAt: "2026-09-10T10:00:00.000Z",
    updatedAt: "2026-09-29T12:00:00.000Z",
  },
  {
    id: "machine-learning",
    title: "Machine Learning Basics",
    description: "Models, evaluation, and core concepts",
    createdAt: "2026-09-06T10:00:00.000Z",
    updatedAt: "2026-09-25T12:00:00.000Z",
  },
  {
    id: "exam-planning",
    title: "Exam Planning",
    description: "A place to collect final revision material",
    createdAt: "2026-09-22T10:00:00.000Z",
    updatedAt: "2026-09-22T10:00:00.000Z",
  },
];

const databaseMaterial: Material = {
  id: "database-indexes",
  title: "Database Indexes.pdf",
  type: "pdf",
  detail: "PDF · 28 pages",
  addedLabel: "Added 3 days ago",
  status: "ready",
};

const databaseCitation = {
  id: "database-source-1",
  materialId: databaseMaterial.id,
  title: databaseMaterial.title,
  excerpt: "A B-tree keeps keys sorted and supports logarithmic search, insertion, and deletion.",
  location: { kind: "page" as const, page: 8 },
};

const machineLearningMaterial: Material = {
  id: "ml-introduction",
  title: "ML Introduction.md",
  type: "note",
  detail: "Markdown · 6 sections",
  addedLabel: "Added 1 week ago",
  status: "ready",
};

export const sampleNotebookContent: Record<string, NotebookContent> = {
  "algorithms-dsa": {
    materials: sampleMaterials,
    conversations: [
      {
        id: "bfs-complexity",
        title: "BFS time complexity",
        updatedLabel: "1 Oct 2026",
        messages: sampleMessages,
      },
      {
        id: "graph-traversal",
        title: "How BFS explores a graph",
        updatedLabel: "28 Sep 2026",
        messages: [
          { id: "graph-question", role: "user", content: "How does BFS explore a graph?", citations: [] },
          {
            id: "graph-answer",
            role: "assistant",
            content: "BFS explores vertices **level by level** from a starting vertex. It uses a queue to track the next vertices to visit.",
            citations: [
              {
                id: "graph-source-1",
                materialId: "graphs",
                title: "Graphs Lecture",
                excerpt: "We visit the vertices one layer at a time. The queue holds the next vertices to explore.",
                location: { kind: "timestamp", seconds: 872 },
              },
            ],
            activity: "Searched 3 materials",
          },
        ],
      },
    ],
    previews: samplePreviews,
    quiz: sampleQuiz,
  },
  "database-systems": {
    materials: [databaseMaterial],
    conversations: [
      {
        id: "database-index-chat",
        title: "Why use B-tree indexes?",
        updatedLabel: "29 Sep 2026",
        messages: [
          { id: "database-question", role: "user", content: "Why use B-tree indexes?", citations: [] },
          {
            id: "database-answer",
            role: "assistant",
            content: "The notes say a **B-tree keeps keys sorted** and supports logarithmic search, insertion, and deletion.",
            citations: [databaseCitation],
            activity: "Searched 1 material",
          },
        ],
      },
    ],
    previews: {
      [databaseMaterial.id]: {
        heading: "B-tree indexes",
        intro: "Indexes help a database locate rows without scanning every record.",
        excerpt: "A B-tree keeps keys sorted and supports logarithmic search, insertion, and deletion.",
        following: "The tree stays balanced as records are added or removed.",
      },
    },
  },
  "machine-learning": {
    materials: [machineLearningMaterial],
    conversations: [],
    previews: {
      [machineLearningMaterial.id]: {
        heading: "Machine learning overview",
        intro: "A model learns patterns from examples in training data.",
        excerpt: "Evaluation uses held-out examples to estimate how well the model generalizes.",
        following: "Choose metrics that match the task and the cost of errors.",
      },
    },
  },
  "exam-planning": { materials: [], conversations: [], previews: {} },
};

