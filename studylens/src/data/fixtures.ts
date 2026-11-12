import type {
  Citation,
  Material,
  QuizQuestion,
  SourcePreview,
  StudyMessage,
} from "@/types";

export const sampleMaterials: Material[] = [
  {
    id: "algorithms",
    title: "Algorithms Notes.pdf",
    type: "pdf",
    detail: "PDF · 42 pages",
    addedLabel: "Added 2 days ago",
    status: "ready",
  },
  {
    id: "revision",
    title: "DSA Revision.md",
    type: "note",
    detail: "Markdown · 12 sections",
    addedLabel: "Added 4 days ago",
    status: "ready",
  },
  {
    id: "graphs",
    title: "Graphs Lecture",
    type: "video",
    detail: "Video · 56 minutes",
    addedLabel: "Added 1 week ago",
    status: "ready",
  },
];

export const sampleCitations: Citation[] = [
  {
    id: "source-1",
    materialId: "algorithms",
    title: "Algorithms Notes.pdf",
    excerpt: "BFS visits each vertex at most once and examines each edge at most twice in an undirected graph.",
    location: { kind: "page", page: 4 },
  },
  {
    id: "source-2",
    materialId: "revision",
    title: "DSA Revision.md",
    excerpt: "The time complexity of BFS is O(V + E) since each vertex enters the queue once.",
    location: { kind: "section", section: "3.2 · Graph traversal" },
  },
];

export const sampleMessages: StudyMessage[] = [
  {
    id: "question-1",
    role: "user",
    content: "What is the time complexity of BFS?",
    citations: [],
  },
  {
    id: "answer-1",
    role: "assistant",
    content:
      "Breadth-First Search runs in **O(V + E)** time, where V is the number of vertices and E is the number of edges. It visits each vertex once and examines each edge at most twice in an undirected graph.",
    citations: sampleCitations,
    activity: "Searched 3 materials",
  },
];

export const sampleQuiz: QuizQuestion = {
  id: "quiz-bfs-1",
  prompt: "What is the time complexity of BFS with an adjacency list?",
  options: [
    { id: "a", label: "O(V + E)" },
    { id: "b", label: "O(V²)" },
    { id: "c", label: "O(E log V)" },
  ],
  correctOptionId: "a",
  explanation: "BFS visits each vertex once and examines each edge during traversal.",
  citation: sampleCitations[0],
};

export const samplePreviews: Record<string, SourcePreview> = {
  algorithms: {
    heading: "Breadth-First Search",
    intro: "Breadth-First Search (BFS) explores a graph level by level from a starting vertex.",
    excerpt: "BFS visits each vertex at most once and examines each edge at most twice in an undirected graph. Using an adjacency list, its total time complexity is O(V + E).",
    following: "BFS uses a queue to maintain the frontier of vertices to be explored.",
  },
  revision: {
    heading: "Graph traversal",
    intro: "Use BFS to explore an unweighted graph by distance from a starting vertex.",
    excerpt: "The time complexity of BFS is O(V + E) since each vertex enters the queue once and each edge is examined during traversal.",
    following: "Keep a visited set and enqueue each newly discovered neighbor.",
  },
  graphs: {
    heading: "Transcript excerpt",
    intro: "Graphs Lecture · 14:32",
    excerpt: "We visit the vertices one layer at a time. The queue holds the next vertices to explore.",
    following: "The same procedure continues until every reachable vertex has been visited.",
  },
};

