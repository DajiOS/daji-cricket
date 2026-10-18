import { libraryRoutes } from './routes/library.ts';
import { cameraRoutes } from './routes/cameras.ts';
import { cardRoutes } from './routes/cards.ts';
import { mediaRoutes } from './routes/media.ts';
import type { Server } from 'node:http';
import type { Config } from './config.ts';
import { Router, createApp } from './http.ts';
import { publicRoutes } from './routes/public.ts';
import { customerRoutes } from './routes/customer.ts';
import { staffRoutes } from './routes/staff.ts';
import { adminRoutes } from './routes/admin.ts';
import { gatewayRoutes } from './routes/gateway.ts';
import { contactRoutes } from './routes/contacts.ts';
import { accountingRoutes } from './routes/accounting.ts';
import { askRoutes } from './routes/ask.ts';
import { academyRoutes } from './routes/academy.ts';
import { matchRoutes } from './routes/matches.ts';
import { booksRoutes } from './routes/books.ts';
import { platformRoutes } from './routes/platform.ts';
import { billsRoutes } from './routes/bills.ts';
import { payrollRoutes } from './routes/payroll.ts';
import { membershipsRoutes } from './routes/memberships.ts';
import { tournamentsRoutes } from './routes/tournaments.ts';
import { complianceRoutes } from './routes/compliance.ts';
import { remindersRoutes } from './routes/reminders.ts';

export function buildRouter(): Router {
  const r = new Router();
  publicRoutes(r);
  customerRoutes(r);
  staffRoutes(r);
  adminRoutes(r);
  gatewayRoutes(r);
  contactRoutes(r);
  accountingRoutes(r);
  askRoutes(r);
  academyRoutes(r);
  matchRoutes(r);
  booksRoutes(r);
  platformRoutes(r);
  billsRoutes(r);
  payrollRoutes(r);
  membershipsRoutes(r);
  tournamentsRoutes(r);
  remindersRoutes(r);
  mediaRoutes(r);
  libraryRoutes(r);
  cameraRoutes(r);
  cardRoutes(r);
  complianceRoutes(r);
  return r;
}

export function buildServer(cfg: Config): Server {
  return createApp(cfg, buildRouter());
}
