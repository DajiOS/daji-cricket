export interface TaskPhoto { url: string; takenAt: number; uploadedByName?: string | null; note?: string | null }
export interface Task {
  id: string; title: string; details: string | null; assignedTo: string | null; assignedName: string | null; priority: 'low' | 'medium' | 'high' | 'urgent';
  stage: 'todo' | 'doing' | 'review' | 'done'; status: 'open' | 'done' | 'cancelled'; dueDate: string | null; overdue: boolean; photosRequired: number; photos: TaskPhoto[];
  commentCount: number; repeat: 'daily' | 'weekly' | 'monthly' | null; checklist: { text: string; done: boolean }[]; projectId: string | null; projectName: string | null; milestoneId: string | null; milestoneTitle: string | null; completedAt: number | null; completedByName: string | null;
  createdAt: number; nextAction: string | null; helpers: { id: string; name: string | null }[]; references: TaskRef[];
  intake: { state: 'new' | 'accepted' | 'declined'; byId: string; byName: string | null; note: string | null } | null;
  acknowledgedAt: number | null; acknowledgedByName: string | null; signedOffAt: number | null; signedOffByName: string | null; reopenNote: string | null;
}
/** A reference explains a job (a gallery or WhatsApp picture, a quote, a PDF, a link). It is never proof. */
export interface TaskRef { id: string; kind: 'file' | 'link'; name: string; mime: string | null; bytes: number | null; url: string; note: string | null; addedById: string; addedByName: string | null; addedAt: number }
export interface Milestone { id: string; title: string; done: boolean; overdue: boolean; dueDate: string | null; tasks: number; tasksDone: number }
export interface Project { id: string; name: string; status: 'active' | 'archived'; areaId: string | null; areaName: string | null; tasks: number; tasksDone: number; milestones: Milestone[] }
export const COLS: [Task['stage'], string][] = [['todo', 'To do'], ['doing', 'In progress'], ['review', 'Review'], ['done', 'Done']];
export const REPEAT: Record<string, string> = { '': 'Does not repeat', daily: 'Every day', weekly: 'Every week', monthly: 'Every month' };
export const PRI: Record<string, string> = { low: 'Low', medium: 'Medium', high: 'High', urgent: 'Urgent' };
