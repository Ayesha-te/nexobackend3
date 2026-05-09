import dotenv from "dotenv";
import { readFileSync } from "node:fs";
import path from "node:path";

// Load environment variables
dotenv.config({ path: path.resolve(process.cwd(), '.env') });


import cors from "cors";
import express from "express";
import helmetImport from "helmet";
import jwt from "jsonwebtoken";
import multer from "multer";
import morgan from "morgan";
import { existsSync, mkdirSync, renameSync, writeFileSync } from "node:fs";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { z } from "zod";
import { MongoClient, Db, Collection } from "mongodb";
import {
  DEFAULT_INVESTMENT_PLANS,
  DEFAULT_REFERRAL_RULES,
  DEFAULT_REWARD_MILESTONES,
  DEFAULT_WITHDRAWAL_RULES,
} from "./business-model.js";

const app = express();
app.set("trust proxy", true);

type HelmetFactory = typeof import("helmet").default;
const helmet =
  ((helmetImport as unknown as { default?: HelmetFactory }).default ??
    (helmetImport as unknown as HelmetFactory));

const PORT = 4000;
const DB_VERSION = 2;
const MONGODB_URI = process.env.MONGODB_URI?.trim();
const JWT_SECRET = createHash("sha256")
  .update(`${MONGODB_URI ?? "missing-mongodb-uri"}::nexo-women-jwt-secret`)
  .digest("hex");
const DEFAULT_ADMIN_NAME = "Nexo Platform Admin";
const DEFAULT_ADMIN_EMAIL = "admin@nexo.com";
const DEFAULT_ADMIN_PHONE = "+92 300 0000000";
const DEFAULT_SUPPORT_EMAIL = "support@nexo.com";
const DEFAULT_ADMIN_PASSWORD = "admin123";
const DEFAULT_PLATFORM_NAME = "Nexo Women Earning System";
const LEGACY_DEFAULT_ACCOUNT_NAME = "Default Account";
const LEGACY_DEFAULT_ACCOUNT_NUMBER = "0000000000";
const LEGACY_DEFAULT_BANK_NAME = "Default Bank";
const LEGACY_DEFAULT_PAYMENT_INSTRUCTIONS = "Default payment instructions";
const DEFAULT_ACCOUNT_NAME = "Sardar Laeiq Ahmed";
const DEFAULT_ACCOUNT_NUMBER = "03448252109";
const DEFAULT_BANK_NAME = "JazzCash";
const DEFAULT_PAYMENT_INSTRUCTIONS =
  "Send payment to this JazzCash account and submit your transaction ID or proof screenshot for admin approval.";
const DEFAULT_DRAW_ENTRY_FEE = 500;
const DEFAULT_DRAW_TITLE = "Monthly Lucky Draw";
const DEFAULT_DRAW_DAYS = 30;
const DEFAULT_ANNOUNCEMENT_TITLE = "Join, Build Your Team & Start Earning";
const DEFAULT_ANNOUNCEMENT_MESSAGE =
  "Choose from 500, 1500, 3000, 6000, or 10000 PKR plans, earn 30% / 15% / 5% referral income, unlock rewards up to 18000 PKR, and withdraw from 1500 PKR with 10% tax in 24-48 hours.";

if (!MONGODB_URI) {
  throw new Error("MONGODB_URI is required. Add it to backend/.env or your hosting environment.");
}

// MongoDB setup - removed JSON database variables
const UPLOADS_DIR = path.resolve(process.cwd(), "uploads");
const PAYMENT_PROOF_DIR = path.join(UPLOADS_DIR, "payment-proofs");

// MongoDB setup
let mongoClient: MongoClient;
let mongoDb: Db;
let collections: {
  users: Collection;
  plans: Collection;
  luckyDraws: Collection;
  paymentSubmissions: Collection;
  investmentOrders: Collection;
  luckyDrawEntries: Collection;
  winnerRecords: Collection;
  walletTransactions: Collection;
  notifications: Collection;
  announcements: Collection;
  auditLogs: Collection;
  settings: Collection;
  rewardClaims: Collection;
  withdrawalRequests: Collection;
};

// Types
type UserRole = "user" | "admin";

type AccountType = "prospect" | "lucky_draw" | "investor" | "hybrid";

type PaymentChannel = "investment" | "lucky_draw";

type PaymentStatus = "pending" | "approved" | "rejected";

type InvestmentStatus = "pending" | "active" | "rejected";

type EntryStatus = "pending" | "active" | "rejected" | "winner";

type WalletTransactionType =
  | "investment_commission"
  | "lucky_draw_commission"
  | "winner_reward"
  | "referral_commission"
  | "points_reward"
  | "withdrawal";

type NotificationType = "system" | "payment" | "commission" | "reward" | "withdrawal";

type DrawStatus = "open" | "completed";

type WithdrawalRequestStatus = "pending" | "approved" | "rejected";

type User = {
  id: string;
  role: UserRole;
  name: string;
  email: string;
  phone: string;
  passwordHash: string;
  referralCode: string;
  referredByUserId: string | null;
  referralLinkEnabled: boolean;
  accountType: AccountType;
  walletBalance: number;
  createdAt: string;
  updatedAt: string;
  lastLoginAt: string | null;
};

type Plan = {
  id: string;
  name: string;
  price: number;
  points: number;
  benefits: string[];
  featured: boolean;
  active: boolean;
  roiPercent?: number;
  durationDays?: number;
  createdAt?: string;
  updatedAt?: string;
  deletedAt?: string | null;
};

type LuckyDraw = {
  id: string;
  title: string;
  entryFee: number;
  drawDate: string;
  terms: string[];
  status: DrawStatus;
  createdAt: string;
  updatedAt: string;
};

type PaymentSubmission = {
  id: string;
  userId: string;
  channel: PaymentChannel;
  amount: number;
  planId: string | null;
  drawId: string | null;
  referenceId: string;
  manualTransactionId: string;
  proofNote: string;
  proofFilePath: string | null;
  proofOriginalFileName: string | null;
  proofMimeType: string | null;
  status: PaymentStatus;
  reviewedByUserId: string | null;
  reviewNote: string;
  createdAt: string;
  reviewedAt: string | null;
};

type InvestmentOrder = {
  id: string;
  userId: string;
  planId: string;
  status: InvestmentStatus;
  createdAt: string;
  activatedAt: string | null;
  rejectedAt: string | null;
};

type LuckyDrawEntry = {
  id: string;
  userId: string;
  drawId: string;
  ticketId: string;
  paymentId: string;
  status: EntryStatus;
  createdAt: string;
  activatedAt: string | null;
  rewardAmount: number;
};

type WinnerRecord = {
  id: string;
  drawId: string;
  entryId: string;
  userId: string;
  rewardAmount: number;
  note: string;
  announcedByUserId: string;
  announcedAt: string;
};

type WalletTransaction = {
  id: string;
  userId: string;
  amount: number;
  direction: "credit" | "debit";
  type: WalletTransactionType;
  description: string;
  referenceId: string | null;
  referenceType: string | null;
  createdAt: string;
};

type RewardMilestone = {
  pointsRequired: number;
  rewardAmount: number;
  title: string;
};

type RewardClaim = {
  id: string;
  userId: string;
  pointsRequired: number;
  rewardAmount: number;
  walletTransactionId: string;
  claimedAt: string;
};

type WithdrawalRequest = {
  id: string;
  userId: string;
  amount: number;
  taxPercent: number;
  taxAmount: number;
  netAmount: number;
  status: WithdrawalRequestStatus;
  note: string;
  reviewNote: string;
  createdAt: string;
  reviewedAt: string | null;
  reviewedByUserId: string | null;
};

type Notification = {
  id: string;
  userId: string;
  type: NotificationType;
  title: string;
  message: string;
  read: boolean;
  createdAt: string;
};

type Announcement = {
  id: string;
  title: string;
  message: string;
  active: boolean;
  createdAt: string;
};

type AuditLog = {
  id: string;
  actorUserId: string | null;
  actorEmail: string;
  actorRole: UserRole;
  action: string;
  targetType: string;
  targetId: string;
  details: Record<string, unknown>;
  createdAt: string;
};

type Settings = {
  platformName: string;
  supportEmail: string;
  enableRegistrations: boolean;
  maintenanceMode: boolean;
  paymentDetails: {
    accountName: string;
    accountNumber: string;
    bankName: string;
    instructions: string;
  };
  referralRules: {
    level1Percent: number;
    level2Percent: number;
    level3Percent: number;
  };
  rewardMilestones: RewardMilestone[];
  withdrawalRules: {
    minimumAmount: number;
    taxPercent: number;
    dailyLimitMin: number;
    dailyLimitMax: number;
    processingHoursMin: number;
    processingHoursMax: number;
  };
};

type AuthPayload = {
  userId: string;
  role: UserRole;
};

type RequestUser = {
  id: string;
  role: UserRole;
  email: string;
};

type AuthenticatedRequest = express.Request & {
  authUser?: RequestUser;
};

declare global {
  namespace Express {
    interface Request {
      authUser?: RequestUser;
    }
  }
}

type AuthenticatedRequestWithOptionalFile = AuthenticatedRequest & {
  file?: Express.Multer.File;
};

const MAX_PROOF_FILE_SIZE_BYTES = 5 * 1024 * 1024;
const ALLOWED_PROOF_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "application/pdf",
]);

app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        scriptSrc: ["'self'"],
        imgSrc: ["'self'", "data:", "https:"],
        connectSrc: ["'self'"],
        fontSrc: ["'self'"],
        objectSrc: ["'none'"],
        mediaSrc: ["'self'"],
        frameSrc: ["'none'"],
      },
    },
  }),
);
app.use(cors({
  origin: true, // Allow any origin for development flexibility
  credentials: true,
}));
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: true, limit: "50mb" }));
app.use(morgan("combined"));
app.use(express.static(path.resolve(process.cwd(), "public")));

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    if (!existsSync(UPLOADS_DIR)) {
      mkdirSync(UPLOADS_DIR, { recursive: true });
    }
    if (!existsSync(PAYMENT_PROOF_DIR)) {
      mkdirSync(PAYMENT_PROOF_DIR, { recursive: true });
    }
    cb(null, PAYMENT_PROOF_DIR);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = randomBytes(8).toString("hex");
    const ext = path.extname(file.originalname);
    cb(null, `${file.fieldname}-${uniqueSuffix}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: {
    fileSize: MAX_PROOF_FILE_SIZE_BYTES,
  },
  fileFilter: (req, file, cb) => {
    if (ALLOWED_PROOF_MIME_TYPES.has(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error(`File type ${file.mimetype} is not allowed`));
    }
  },
});

// Zod schemas
const registerSchema = z.object({
  name: z.string().trim().min(3),
  email: z.string().trim().email(),
  phone: z.string().trim().min(10),
  password: z.string().min(6),
  referralCode: z.string().trim().optional(),
});

const loginSchema = z.object({
  email: z.string().trim().email(),
  password: z.string().min(6),
});

const investmentSubmissionSchema = z.object({
  planId: z.string().min(1),
  manualTransactionId: z.string().trim().min(1),
  proofNote: z.string().trim().optional(),
});

const luckyDrawEntrySchema = z.object({
  drawId: z.string().min(1),
  manualTransactionId: z.string().trim().min(1),
  proofNote: z.string().trim().optional(),
});

const paymentDecisionSchema = z.object({
  status: z.enum(["approved", "rejected"]),
  reviewNote: z.string().trim().optional(),
});

const winnerSelectionSchema = z.object({
  entryIds: z.array(z.string()),
  rewardAmount: z.number().positive(),
  note: z.string().trim().min(1),
});

const rewardClaimSchema = z.object({
  pointsRequired: z.number().positive(),
});

const withdrawalRequestSchema = z.object({
  amount: z.number().positive(),
  note: z.string().trim().optional(),
});

const withdrawalDecisionSchema = z.object({
  status: z.enum(["approved", "rejected"]),
  reviewNote: z.string().trim().optional(),
});

const settingsSchema = z.object({
  platformName: z.string().trim().min(1),
  supportEmail: z.string().trim().email(),
  enableRegistrations: z.boolean(),
  maintenanceMode: z.boolean(),
  paymentDetails: z.object({
    accountName: z.string().trim().min(1),
    accountNumber: z.string().trim().min(1),
    bankName: z.string().trim().min(1),
    instructions: z.string().trim().min(1),
  }),
  referralRules: z.object({
    level1Percent: z.number().min(0).max(100),
    level2Percent: z.number().min(0).max(100),
    level3Percent: z.number().min(0).max(100),
  }),
  rewardMilestones: z.array(z.object({
    pointsRequired: z.number().positive(),
    rewardAmount: z.number().positive(),
    title: z.string().trim().min(1),
  })),
  withdrawalRules: z.object({
    minimumAmount: z.number().positive(),
    taxPercent: z.number().min(0).max(100),
    dailyLimitMin: z.number().positive(),
    dailyLimitMax: z.number().positive(),
    processingHoursMin: z.number().positive(),
    processingHoursMax: z.number().positive(),
  }),
  announcement: z.object({
    title: z.string().trim().min(1),
    message: z.string().trim().min(1),
  }),
});

const adminPlanSchema = z.object({
  name: z.string().trim().min(1),
  price: z.number().positive(),
  points: z.number().int().positive(),
  benefits: z.array(z.string().trim()).optional().default([]),
  featured: z.boolean().optional().default(false),
  active: z.boolean().optional().default(true),
});

const profileSchema = z.object({
  name: z.string().trim().min(3),
  phone: z.string().trim().min(10),
});

// Helper functions
function nowIso() {
  return new Date().toISOString();
}

function generateId(prefix: string) {
  return `${prefix}-${randomUUID()}`;
}

function generateReferralCode() {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let result = "";
  for (let i = 0; i < 8; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

function generateTicketId() {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let result = "";
  for (let i = 0; i < 12; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

function getDefaultPlanBenefits(points: number) {
  return [
    `${points} reward points on approval`,
    "Eligible for 3-level referral income",
    "Counts toward rank rewards",
  ];
}

function normalizePlanBenefits(benefits: string[] | undefined, points: number) {
  const uniqueBenefits = Array.from(
    new Set(
      (benefits ?? [])
        .map((benefit) => benefit.trim())
        .filter(Boolean),
    ),
  );

  return uniqueBenefits.length > 0 ? uniqueBenefits : getDefaultPlanBenefits(points);
}

function roundCurrency(amount: number) {
  return Math.round(amount * 100) / 100;
}

function getForwardedHeaderValue(value: string | string[] | undefined) {
  if (Array.isArray(value)) {
    return value[0]?.trim();
  }

  return value?.split(",")[0]?.trim();
}

function getRequestOrigin(req: express.Request) {
  const forwardedProto = getForwardedHeaderValue(req.headers["x-forwarded-proto"]);
  const forwardedHost = getForwardedHeaderValue(req.headers["x-forwarded-host"]);
  const host = forwardedHost || req.get("host") || `localhost:${PORT}`;
  const protocol = forwardedProto || req.protocol || "http";

  return `${protocol}://${host}`.replace(/\/+$/, "");
}

function getRequestAppBaseUrl(req: express.Request) {
  const originHeader = req.get("origin")?.trim();
  if (originHeader) {
    return originHeader.replace(/\/+$/, "");
  }

  const referer = req.get("referer")?.trim();
  if (referer) {
    try {
      const parsedUrl = new URL(referer);
      return `${parsedUrl.protocol}//${parsedUrl.host}`.replace(/\/+$/, "");
    } catch {
      // Ignore malformed referer headers and fall back to the request origin.
    }
  }

  return getRequestOrigin(req);
}

function getPublicFileUrl(req: express.Request | null, filePath: string | null) {
  if (!filePath) return null;

  const relativePath = `/files/${path.basename(filePath)}`;
  if (!req) {
    return relativePath;
  }

  return `${getRequestOrigin(req)}${relativePath}`;
}

function getReferralLink(req: express.Request | null, referralCode: string) {
  const relativePath = `/r/${referralCode}`;
  if (!req) {
    return relativePath;
  }

  return `${getRequestAppBaseUrl(req)}${relativePath}`;
}

async function hashPassword(password: string): Promise<string> {
  // Using Node.js crypto for password hashing since Bun is not available
  const crypto = await import('node:crypto');
  return crypto.createHash('sha256').update(password).digest('hex');
}

async function verifyPassword(password: string, hash: string): Promise<boolean> {
  const crypto = await import('node:crypto');
  const computedHash = crypto.createHash('sha256').update(password).digest('hex');
  return computedHash === hash;
}

function parseSchema<T>(schema: z.ZodType<T>, body: unknown, res: express.Response): T | null {
  const result = schema.safeParse(body);
  if (!result.success) {
    res.status(400).json({ message: result.error.issues[0].message });
    return null;
  }
  return result.data;
}

function respondToUploadError(res: express.Response, error: unknown) {
  if (error instanceof Error) {
    if (error.message.includes("File type")) {
      return res.status(400).json({
        message: "Invalid file type. Only JPG, PNG, WebP, GIF, and PDF files are allowed.",
      });
    }
    if (error.message.includes("File too large")) {
      return res.status(400).json({
        message: `File too large. Maximum size is ${MAX_PROOF_FILE_SIZE_BYTES / (1024 * 1024)}MB.`,
      });
    }
    return res.status(500).json({ message: error.message });
  }
  return res.status(500).json({ message: "Upload failed" });
}

function buildStoredProofDetails(file?: Express.Multer.File) {
  if (!file) {
    return {
      proofFilePath: null,
      proofOriginalFileName: null,
      proofMimeType: null,
    };
  }

  const timestamp = nowIso().replace(/[:.]/g, "-");
  const ext = path.extname(file.originalname);
  const newFileName = `proof-${timestamp}-${file.originalname}`;
  const newFilePath = path.join(PAYMENT_PROOF_DIR, newFileName);

  renameSync(file.path, newFilePath);

  return {
    proofFilePath: newFilePath,
    proofOriginalFileName: file.originalname,
    proofMimeType: file.mimetype,
  };
}

function serializePaymentSubmission(
  payment: PaymentSubmission,
  req: express.Request | null = null,
) {
  return {
    ...payment,
    proofFileUrl: getPublicFileUrl(req, payment.proofFilePath),
  };
}

function createToken(user: RequestUser) {
  return jwt.sign(
    { userId: user.id, role: user.role, email: user.email },
    JWT_SECRET,
    { expiresIn: "7d" }
  );
}

async function getUserById(userId: string): Promise<User | null> {
  const user = await collections.users.findOne({ id: userId });
  return user as unknown as User | null;
}

async function getPlanById(planId: string): Promise<Plan | null> {
  const plan = await collections.plans.findOne({ id: planId });
  return plan ? normalizePlan(plan) : null;
}

async function getDrawById(drawId: string): Promise<LuckyDraw | null> {
  const draw = await collections.luckyDraws.findOne({ id: drawId });
  return draw as unknown as LuckyDraw | null;
}

async function getActiveDraw(): Promise<LuckyDraw | null> {
  const draw = await collections.luckyDraws.findOne({ status: "open" });
  return draw as unknown as LuckyDraw | null;
}

function normalizeSettings(settings?: Partial<Settings> | null): Settings {
  return {
    platformName: settings?.platformName ?? DEFAULT_PLATFORM_NAME,
    supportEmail: settings?.supportEmail ?? DEFAULT_SUPPORT_EMAIL,
    enableRegistrations: settings?.enableRegistrations ?? true,
    maintenanceMode: settings?.maintenanceMode ?? false,
    paymentDetails: {
      accountName: settings?.paymentDetails?.accountName ?? DEFAULT_ACCOUNT_NAME,
      accountNumber: settings?.paymentDetails?.accountNumber ?? DEFAULT_ACCOUNT_NUMBER,
      bankName: settings?.paymentDetails?.bankName ?? DEFAULT_BANK_NAME,
      instructions: settings?.paymentDetails?.instructions ?? DEFAULT_PAYMENT_INSTRUCTIONS,
    },
    referralRules: {
      level1Percent:
        settings?.referralRules?.level1Percent ?? DEFAULT_REFERRAL_RULES.level1Percent,
      level2Percent:
        settings?.referralRules?.level2Percent ?? DEFAULT_REFERRAL_RULES.level2Percent,
      level3Percent:
        settings?.referralRules?.level3Percent ?? DEFAULT_REFERRAL_RULES.level3Percent,
    },
    rewardMilestones:
      settings?.rewardMilestones?.length
        ? settings.rewardMilestones
            .map((milestone) => ({
              pointsRequired: Number(milestone.pointsRequired),
              rewardAmount: Number(milestone.rewardAmount),
              title: milestone.title,
            }))
            .sort((left, right) => left.pointsRequired - right.pointsRequired)
        : DEFAULT_REWARD_MILESTONES.map((milestone) => ({ ...milestone })),
    withdrawalRules: {
      minimumAmount:
        settings?.withdrawalRules?.minimumAmount ?? DEFAULT_WITHDRAWAL_RULES.minimumAmount,
      taxPercent: settings?.withdrawalRules?.taxPercent ?? DEFAULT_WITHDRAWAL_RULES.taxPercent,
      dailyLimitMin:
        settings?.withdrawalRules?.dailyLimitMin ?? DEFAULT_WITHDRAWAL_RULES.dailyLimitMin,
      dailyLimitMax:
        settings?.withdrawalRules?.dailyLimitMax ?? DEFAULT_WITHDRAWAL_RULES.dailyLimitMax,
      processingHoursMin:
        settings?.withdrawalRules?.processingHoursMin ??
        DEFAULT_WITHDRAWAL_RULES.processingHoursMin,
      processingHoursMax:
        settings?.withdrawalRules?.processingHoursMax ??
        DEFAULT_WITHDRAWAL_RULES.processingHoursMax,
    },
  };
}

async function getPublicSettings(): Promise<Settings> {
  const settingsResult = await collections.settings.findOne({});
  return normalizeSettings((settingsResult as Partial<Settings> | null) ?? null);
}

function normalizePlan(plan: any): Plan {
  return {
    id: String(plan.id),
    name: String(plan.name),
    price: Number(plan.price),
    points: Number(plan.points ?? 0),
    benefits: Array.isArray(plan.benefits) ? plan.benefits.map(String) : [],
    featured: Boolean(plan.featured),
    active: plan.active !== false,
    roiPercent: typeof plan.roiPercent === "number" ? plan.roiPercent : undefined,
    durationDays: typeof plan.durationDays === "number" ? plan.durationDays : undefined,
    createdAt: typeof plan.createdAt === "string" ? plan.createdAt : undefined,
    updatedAt: typeof plan.updatedAt === "string" ? plan.updatedAt : undefined,
    deletedAt:
      typeof plan.deletedAt === "string" || plan.deletedAt === null ? plan.deletedAt : undefined,
  };
}

async function getActivePlans(): Promise<Plan[]> {
  const plans = await collections.plans
    .find({
      active: { $ne: false },
      $or: [{ deletedAt: { $exists: false } }, { deletedAt: null }],
    })
    .sort({ price: 1 })
    .toArray();
  return plans.map((plan) => normalizePlan(plan));
}

async function serializeAdminPlan(planInput: any) {
  const plan = normalizePlan(planInput);
  const [linkedInvestments, linkedPayments] = await Promise.all([
    collections.investmentOrders.countDocuments({ planId: plan.id }),
    collections.paymentSubmissions.countDocuments({ planId: plan.id }),
  ]);

  return {
    ...plan,
    benefits: normalizePlanBenefits(plan.benefits, plan.points),
    linkedInvestments,
    linkedPayments,
  };
}

async function getAdminPlans() {
  const plans = await collections.plans
    .find({
      $or: [{ deletedAt: { $exists: false } }, { deletedAt: null }],
    })
    .sort({ active: -1, price: 1, createdAt: -1 })
    .toArray();

  return Promise.all(plans.map((plan) => serializeAdminPlan(plan)));
}

async function getUserInvestmentOrders(userId: string, status?: InvestmentStatus) {
  const query = status ? { userId, status } : { userId };
  return (await collections.investmentOrders.find(query).sort({ createdAt: -1 }).toArray()) as unknown as InvestmentOrder[];
}

async function getUserPoints(userId: string) {
  const orders = await getUserInvestmentOrders(userId, "active");
  const plans = await Promise.all(orders.map((order) => getPlanById(order.planId)));
  return plans.reduce((sum, plan) => sum + Number(plan?.points ?? 0), 0);
}

async function getUserActiveInvestmentValue(userId: string) {
  const orders = await getUserInvestmentOrders(userId, "active");
  const plans = await Promise.all(orders.map((order) => getPlanById(order.planId)));
  return roundCurrency(plans.reduce((sum, plan) => sum + Number(plan?.price ?? 0), 0));
}

async function getRewardClaimsForUser(userId: string) {
  return (await collections.rewardClaims.find({ userId }).sort({ claimedAt: -1 }).toArray()) as unknown as RewardClaim[];
}

async function getReservedWithdrawalAmount(userId: string) {
  const pendingRequests = (await collections.withdrawalRequests.find({
    userId,
    status: "pending",
  }).toArray()) as unknown as WithdrawalRequest[];
  return roundCurrency(pendingRequests.reduce((sum, request) => sum + request.amount, 0));
}

async function getWalletBalance(userId: string): Promise<number> {
  const transactions = (await collections.walletTransactions.find({ userId }).toArray()) as unknown as WalletTransaction[];
  return roundCurrency(
    transactions.reduce((sum, transaction) => {
      const direction = transaction.direction ?? "credit";
      return direction === "debit" ? sum - transaction.amount : sum + transaction.amount;
    }, 0),
  );
}

async function getAvailableWalletBalance(userId: string) {
  const [walletBalance, reservedAmount] = await Promise.all([
    getWalletBalance(userId),
    getReservedWithdrawalAmount(userId),
  ]);
  return roundCurrency(walletBalance - reservedAmount);
}

async function getWalletTransactionsForUser(userId: string) {
  return (await collections.walletTransactions.find({ userId }).sort({ createdAt: -1 }).toArray()) as unknown as WalletTransaction[];
}

async function serializeUser(user: User, req: express.Request | null = null) {
  const sponsor = user.referredByUserId ? await getUserById(user.referredByUserId) : null;
  return {
    id: user.id,
    role: user.role,
    name: user.name,
    email: user.email,
    phone: user.phone,
    referralCode: user.referralCode,
    referredByUserId: user.referredByUserId,
    sponsorName: sponsor?.name ?? null,
    sponsorReferralCode: sponsor?.referralCode ?? null,
    referralLinkEnabled: true,
    referralLink: getReferralLink(req, user.referralCode),
    accountType: user.accountType,
    walletBalance: await getWalletBalance(user.id),
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
    lastLoginAt: user.lastLoginAt,
  };
}

async function addNotification(userId: string, type: NotificationType, title: string, message: string) {
  const notification: Notification = {
    id: generateId("NOT"),
    userId,
    type,
    title,
    message,
    read: false,
    createdAt: nowIso(),
  };
  await collections.notifications.insertOne(notification);
}

async function addAuditLog(
  actor: { userId?: string; email: string; role: UserRole },
  action: string,
  targetType: string,
  targetId: string,
  details?: Record<string, unknown>,
) {
  const auditLog: AuditLog = {
    id: generateId("AUD"),
    actorUserId: actor.userId ?? null,
    actorEmail: actor.email,
    actorRole: actor.role,
    action,
    targetType,
    targetId,
    details: details ?? {},
    createdAt: nowIso(),
  };
  await collections.auditLogs.insertOne(auditLog);
}

async function addWalletTransaction(
  input: Omit<WalletTransaction, "id" | "createdAt">,
) {
  const transaction: WalletTransaction = {
    id: generateId("WAL"),
    createdAt: nowIso(),
    ...input,
  };
  await collections.walletTransactions.insertOne(transaction);
  return transaction;
}

async function addWalletCredit(
  userId: string,
  type: WalletTransactionType,
  amount: number,
  description: string,
  referenceId: string,
  referenceType: string,
) {
  return addWalletTransaction({
    userId,
    amount: roundCurrency(amount),
    direction: "credit",
    type,
    description,
    referenceId,
    referenceType,
  });
}

async function addWalletDebit(
  userId: string,
  type: WalletTransactionType,
  amount: number,
  description: string,
  referenceId: string,
  referenceType: string,
) {
  return addWalletTransaction({
    userId,
    amount: roundCurrency(amount),
    direction: "debit",
    type,
    description,
    referenceId,
    referenceType,
  });
}

async function getReferralCounts(userId: string) {
  const level1Users = (await collections.users.find({
    referredByUserId: userId,
    role: "user",
  }).toArray()) as unknown as User[];
  const level1Ids = level1Users.map((user) => user.id);

  const level2Users =
    level1Ids.length > 0
      ? ((await collections.users.find({
          referredByUserId: { $in: level1Ids },
          role: "user",
        }).toArray()) as unknown as User[])
      : [];
  const level2Ids = level2Users.map((user) => user.id);

  const level3Users =
    level2Ids.length > 0
      ? ((await collections.users.find({
          referredByUserId: { $in: level2Ids },
          role: "user",
        }).toArray()) as unknown as User[])
      : [];

  const directUsers = await Promise.all(
    level1Users.map(async (referral) => ({
      id: referral.id,
      name: referral.name,
      email: referral.email,
      accountType: referral.accountType,
      joinedAt: referral.createdAt,
      totalPoints: await getUserPoints(referral.id),
      activeInvestmentValue: await getUserActiveInvestmentValue(referral.id),
    })),
  );

  return {
    level1: level1Users.length,
    level2: level2Users.length,
    level3: level3Users.length,
    directUsers,
  };
}

async function getRewardMilestoneSummary(userId: string) {
  const settings = await getPublicSettings();
  const [totalPoints, claims] = await Promise.all([
    getUserPoints(userId),
    getRewardClaimsForUser(userId),
  ]);

  const claimedPoints = new Set(claims.map((claim) => claim.pointsRequired));
  const milestones = settings.rewardMilestones.map((milestone) => ({
    ...milestone,
    claimed: claimedPoints.has(milestone.pointsRequired),
    claimable: totalPoints >= milestone.pointsRequired && !claimedPoints.has(milestone.pointsRequired),
    remainingPoints: Math.max(milestone.pointsRequired - totalPoints, 0),
  }));
  const nextMilestone = milestones.find((milestone) => !milestone.claimed) ?? null;

  return {
    totalPoints,
    claims,
    milestones,
    nextMilestone,
    totalClaimedRewardValue: claims.reduce((sum, claim) => sum + claim.rewardAmount, 0),
  };
}

async function getReferralUplines(user: User, maxLevels = 3) {
  const uplines: Array<{ level: number; user: User }> = [];
  let currentUser = user;

  for (let level = 1; level <= maxLevels; level += 1) {
    if (!currentUser.referredByUserId) {
      break;
    }

    const sponsor = await getUserById(currentUser.referredByUserId);
    if (!sponsor) {
      break;
    }

    uplines.push({ level, user: sponsor });
    currentUser = sponsor;
  }

  return uplines;
}

async function distributeInvestmentCommissions(user: User, plan: Plan, paymentId: string) {
  const settings = await getPublicSettings();
  const uplines = await getReferralUplines(user, 3);
  const percentages = [
    settings.referralRules.level1Percent,
    settings.referralRules.level2Percent,
    settings.referralRules.level3Percent,
  ];

  for (const { level, user: sponsor } of uplines) {
    const percentage = percentages[level - 1] ?? 0;
    if (percentage <= 0) {
      continue;
    }

    const amount = roundCurrency((plan.price * percentage) / 100);
    await addWalletCredit(
      sponsor.id,
      "referral_commission",
      amount,
      `Level ${level} referral commission from ${user.name}'s ${plan.name}`,
      paymentId,
      "investment",
    );
    await addNotification(
      sponsor.id,
      "commission",
      `Level ${level} referral commission credited`,
      `You received ${amount.toLocaleString("en-PK")} PKR from ${user.name}'s ${plan.name}.`,
    );
  }
}

async function recomputeUserAccountType(userId: string) {
  const user = await getUserById(userId);
  if (!user) {
    return;
  }

  const activeInvestmentCount = await collections.investmentOrders.countDocuments({
    userId,
    status: "active",
  });

  const newAccountType: AccountType = activeInvestmentCount > 0 ? "investor" : "prospect";
  if (newAccountType !== user.accountType) {
    await collections.users.updateOne(
      { id: userId },
      { $set: { accountType: newAccountType, updatedAt: nowIso() } },
    );
  }
}

function calculateInvestmentMetrics(order: InvestmentOrder, plan: Plan) {
  const isActive = order.status === "active";
  return {
    dailyEarning: 0,
    totalReturn: plan.price,
    earned: isActive ? plan.points : 0,
    remaining: 0,
    daysElapsed: isActive ? 1 : 0,
    durationDays: 1,
    progressPercent: isActive ? 100 : 0,
    points: plan.points,
  };
}

function requireAdmin(req: AuthenticatedRequest, res: express.Response, next: express.NextFunction) {
  if (req.authUser?.role !== "admin") {
    return res.status(403).json({ message: "Admin access required" });
  }
  next();
}

async function authenticate(req: AuthenticatedRequest, res: express.Response, next: express.NextFunction) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ message: "Missing or invalid token" });
  }

  const token = authHeader.substring(7);
  try {
    const decoded = jwt.verify(token, JWT_SECRET) as AuthPayload;
    const user = await getUserById(decoded.userId);
    if (!user) {
      return res.status(401).json({ message: "Invalid token" });
    }
    req.authUser = { id: user.id, role: user.role, email: user.email };
    next();
  } catch (error) {
    return res.status(401).json({ message: " Invalid token" });
  }
}

function runPaymentProofUpload(req: express.Request, res: express.Response) {
  return new Promise<void>((resolve, reject) => {
    upload.single("proofFile")(req, res, (error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

function hasPaymentProof(proofNote?: string, file?: Express.Multer.File) {
  return (proofNote?.trim().length ?? 0) >= 3 || Boolean(file);
}

// MongoDB connection
async function connectToMongoDB() {
  try {
    mongoClient = new MongoClient(MONGODB_URI);
    await mongoClient.connect();
    mongoDb = mongoClient.db();
    
    // Initialize collections
    collections = {
      users: mongoDb.collection('users'),
      plans: mongoDb.collection('plans'),
      luckyDraws: mongoDb.collection('luckyDraws'),
      paymentSubmissions: mongoDb.collection('paymentSubmissions'),
      investmentOrders: mongoDb.collection('investmentOrders'),
      luckyDrawEntries: mongoDb.collection('luckyDrawEntries'),
      winnerRecords: mongoDb.collection('winnerRecords'),
      walletTransactions: mongoDb.collection('walletTransactions'),
      notifications: mongoDb.collection('notifications'),
      announcements: mongoDb.collection('announcements'),
      auditLogs: mongoDb.collection('auditLogs'),
      settings: mongoDb.collection('settings'),
      rewardClaims: mongoDb.collection('rewardClaims'),
      withdrawalRequests: mongoDb.collection('withdrawalRequests'),
    };
    
    console.log('Connected to MongoDB Atlas successfully 🚀');
    await initializeDatabase();
  } catch (error) {
    console.error('Failed to connect to MongoDB Atlas:', error);
    process.exit(1);
  }
}

async function initializeDatabase() {
  // Check if database is already initialized
  const settingsCount = await collections.settings.countDocuments();
  if (settingsCount > 0) {
    console.log('Database already initialized');
    await syncBusinessModel();
    return;
  }

  console.log('Initializing database with default data...');
  
  // Create default plans
  const defaultPlans: Plan[] = DEFAULT_INVESTMENT_PLANS.map((plan) => ({
    ...plan,
    benefits: [...plan.benefits],
    roiPercent: 0,
    durationDays: 0,
    createdAt: nowIso(),
    updatedAt: nowIso(),
    deletedAt: null,
  }));

  // Create default lucky draw
  const defaultDraw: LuckyDraw = {
    id: generateId("DRAW"),
    title: "Monthly Lucky Draw",
    entryFee: 500,
    drawDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
    terms: ["One entry per payment", "Winners selected randomly", "Prize credited to wallet"],
    status: "open",
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };

  // Create default settings
  const defaultSettings: Settings = normalizeSettings({
    platformName: DEFAULT_PLATFORM_NAME,
    supportEmail: DEFAULT_SUPPORT_EMAIL,
    enableRegistrations: true,
    maintenanceMode: false,
    paymentDetails: {
      accountName: DEFAULT_ACCOUNT_NAME,
      accountNumber: DEFAULT_ACCOUNT_NUMBER,
      bankName: DEFAULT_BANK_NAME,
      instructions: DEFAULT_PAYMENT_INSTRUCTIONS,
    },
  });

  // Create default admin user
  const defaultAdmin: User = {
    id: generateId("USER"),
    role: "admin",
    name: DEFAULT_ADMIN_NAME,
    email: DEFAULT_ADMIN_EMAIL,
    phone: DEFAULT_ADMIN_PHONE,
    passwordHash: await hashPassword(DEFAULT_ADMIN_PASSWORD),
    referralCode: generateReferralCode(),
    referredByUserId: null,
    referralLinkEnabled: true,
    accountType: "investor",
    walletBalance: 0,
    createdAt: nowIso(),
    updatedAt: nowIso(),
    lastLoginAt: null,
  };

  // Insert all default data
  await collections.plans.insertMany(defaultPlans);
  await collections.luckyDraws.insertOne(defaultDraw);
  await collections.settings.insertOne(defaultSettings);
  await collections.users.insertOne(defaultAdmin);
  await collections.announcements.insertOne({
    id: generateId("ANN"),
    title: DEFAULT_ANNOUNCEMENT_TITLE,
    message: DEFAULT_ANNOUNCEMENT_MESSAGE,
    active: true,
    createdAt: nowIso(),
  });

  await syncBusinessModel();
  console.log('Database initialized successfully');
}

async function syncBusinessModel() {
  const plans = await collections.plans.find({}).toArray();

  if (plans.length === 0) {
    const seededPlans: Plan[] = DEFAULT_INVESTMENT_PLANS.map((plan) => ({
      ...plan,
      benefits: [...plan.benefits],
      roiPercent: 0,
      durationDays: 0,
      createdAt: nowIso(),
      updatedAt: nowIso(),
      deletedAt: null,
    }));

    await collections.plans.insertMany(seededPlans);
  } else {
    for (const rawPlan of plans) {
      const normalizedPlan = normalizePlan(rawPlan);

      await collections.plans.updateOne(
        { id: normalizedPlan.id },
        {
          $set: {
            name: normalizedPlan.name,
            price: normalizedPlan.price,
            points: normalizedPlan.points,
            benefits: normalizePlanBenefits(normalizedPlan.benefits, normalizedPlan.points),
            featured: normalizedPlan.featured,
            active: normalizedPlan.active,
            roiPercent: 0,
            durationDays: 0,
            createdAt:
              typeof rawPlan.createdAt === "string" ? rawPlan.createdAt : nowIso(),
            updatedAt:
              typeof rawPlan.updatedAt === "string" ? rawPlan.updatedAt : nowIso(),
            deletedAt:
              typeof rawPlan.deletedAt === "string" || rawPlan.deletedAt === null
                ? rawPlan.deletedAt
                : null,
          },
        },
      );
    }
  }

  const currentSettings = (await collections.settings.findOne({})) as Partial<Settings> | null;
  const shouldApplyDefaultPlatformName =
    !currentSettings?.platformName || currentSettings.platformName === "Nexo Investment Platform";
  const shouldApplyDefaultAccountName =
    !currentSettings?.paymentDetails?.accountName ||
    currentSettings.paymentDetails.accountName === LEGACY_DEFAULT_ACCOUNT_NAME;
  const shouldApplyDefaultAccountNumber =
    !currentSettings?.paymentDetails?.accountNumber ||
    currentSettings.paymentDetails.accountNumber === LEGACY_DEFAULT_ACCOUNT_NUMBER;
  const shouldApplyDefaultBankName =
    !currentSettings?.paymentDetails?.bankName ||
    currentSettings.paymentDetails.bankName === LEGACY_DEFAULT_BANK_NAME;
  const shouldApplyDefaultPaymentInstructions =
    !currentSettings?.paymentDetails?.instructions ||
    currentSettings.paymentDetails.instructions === LEGACY_DEFAULT_PAYMENT_INSTRUCTIONS;
  const nextSettings = normalizeSettings({
    ...(currentSettings ?? {}),
    platformName: shouldApplyDefaultPlatformName
      ? DEFAULT_PLATFORM_NAME
      : currentSettings?.platformName,
    paymentDetails: {
      ...(currentSettings?.paymentDetails ?? {}),
      accountName: shouldApplyDefaultAccountName
        ? DEFAULT_ACCOUNT_NAME
        : currentSettings?.paymentDetails?.accountName,
      accountNumber: shouldApplyDefaultAccountNumber
        ? DEFAULT_ACCOUNT_NUMBER
        : currentSettings?.paymentDetails?.accountNumber,
      bankName: shouldApplyDefaultBankName
        ? DEFAULT_BANK_NAME
        : currentSettings?.paymentDetails?.bankName,
      instructions: shouldApplyDefaultPaymentInstructions
        ? DEFAULT_PAYMENT_INSTRUCTIONS
        : currentSettings?.paymentDetails?.instructions,
    },
  });
  await collections.settings.updateOne({}, { $set: nextSettings }, { upsert: true });

  const activeAnnouncement = await collections.announcements.findOne({ active: true });
  if (!activeAnnouncement) {
    await collections.announcements.insertOne({
      id: generateId("ANN"),
      title: DEFAULT_ANNOUNCEMENT_TITLE,
      message: DEFAULT_ANNOUNCEMENT_MESSAGE,
      active: true,
      createdAt: nowIso(),
    });
  }

  await collections.users.updateMany(
    {},
    {
      $set: {
        referralLinkEnabled: true,
      },
    },
  );
}

// Routes
app.get("/api/health", (req, res) => {
  res.json({
    status: "ok",
    apiBaseUrl: `${getRequestOrigin(req)}/api`,
  });
});

app.get("/files/:fileName", (req, res) => {
  const safeFileName = path.basename(req.params.fileName);
  const filePath = path.join(PAYMENT_PROOF_DIR, safeFileName);

  if (!existsSync(filePath)) {
    return res.status(404).json({ message: "File not found." });
  }

  return res.sendFile(filePath);
});

app.post("/api/auth/register", async (req, res) => {
  const body = parseSchema(registerSchema, req.body, res);
  if (!body) {
    return;
  }

  const existingUser = await collections.users.findOne({ email: body.email.trim() });
  if (existingUser) {
    return res.status(409).json({ message: "Email already exists." });
  }

  let referredByUserId = null;
  if (body.referralCode) {
    const referrer = await collections.users.findOne({ referralCode: body.referralCode });
    if (referrer) {
      referredByUserId = referrer.id;
    }
  }

  const user: User = {
    id: generateId("USER"),
    role: "user",
    name: body.name.trim(),
    email: body.email.trim(),
    phone: body.phone.trim(),
    passwordHash: await hashPassword(body.password),
    referralCode: generateReferralCode(),
    referredByUserId,
    referralLinkEnabled: true,
    accountType: "prospect",
    walletBalance: 0,
    createdAt: nowIso(),
    updatedAt: nowIso(),
    lastLoginAt: null,
  };

  await collections.users.insertOne(user);
  await addNotification(
    user.id,
    "system",
    "Welcome to Nexo Women Earning System",
    "Your account is ready. Choose a plan, collect points, and start building your 3-level team.",
  );

  if (referredByUserId) {
    await addNotification(
      referredByUserId,
      "commission",
      "New Referral",
      `${user.name} joined using your referral code. Commission starts when their investment is approved.`,
    );
  }

  return res.status(201).json({
    user: await serializeUser(user, req),
    token: createToken({ id: user.id, role: user.role, email: user.email }),
  });
});

app.post("/api/auth/login", async (req, res) => {
  const body = parseSchema(loginSchema, req.body, res);
  if (!body) {
    return;
  }

  const user = await collections.users.findOne({ email: body.email }) as unknown as User | null;
  if (!user || !await verifyPassword(body.password, user.passwordHash)) {
    return res.status(401).json({ message: "Invalid email or password." });
  }

  await collections.users.updateOne(
    { id: user.id },
    { $set: { lastLoginAt: nowIso() } }
  );

  const refreshedUser = await getUserById(user.id);
  return res.json({
    token: createToken(user as any),
    user: refreshedUser ? await serializeUser(refreshedUser, req) : await serializeUser(user, req),
  });
});

app.get("/api/auth/me", authenticate, async (req: AuthenticatedRequest, res) => {
  const user = await getUserById(req.authUser!.id);

  if (!user) {
    return res.status(404).json({ message: "User not found." });
  }

  return res.json({ user: await serializeUser(user, req) });
});

app.get("/api/user/dashboard", authenticate, async (req: AuthenticatedRequest, res) => {
  const user = await getUserById(req.authUser!.id);
  if (!user) {
    return res.status(404).json({ message: "User not found." });
  }

  const [investmentOrders, walletTransactions, referralSummary, rewardProgress, notifications] =
    await Promise.all([
      getUserInvestmentOrders(user.id),
      getWalletTransactionsForUser(user.id),
      getReferralCounts(user.id),
      getRewardMilestoneSummary(user.id),
      collections.notifications
        .find({ userId: user.id })
        .sort({ createdAt: -1 })
        .limit(8)
        .toArray(),
    ]);

  const investments = await Promise.all(
    investmentOrders.map(async (order) => {
      const plan = await getPlanById(order.planId);
      if (!plan) {
        return null;
      }

      return {
        ...order,
        plan,
        metrics: calculateInvestmentMetrics(order, plan),
      };
    }),
  ).then((items) => items.filter(Boolean));

  const totalInvestment = roundCurrency(
    investments
      .filter((investment: any) => investment.status === "active")
      .reduce((sum, investment: any) => sum + investment.plan.price, 0),
  );
  const totalCommissionEarned = roundCurrency(
    walletTransactions
      .filter((transaction) =>
        ["referral_commission", "investment_commission", "lucky_draw_commission"].includes(
          transaction.type,
        ),
      )
      .reduce((sum, transaction) => sum + transaction.amount, 0),
  );
  const totalRewardValue = roundCurrency(
    walletTransactions
      .filter((transaction) => ["points_reward", "winner_reward"].includes(transaction.type))
      .reduce((sum, transaction) => sum + transaction.amount, 0),
  );

  return res.json({
    user: await serializeUser(user, req),
    stats: {
      totalInvestment,
      totalPoints: rewardProgress.totalPoints,
      walletBalance: await getWalletBalance(user.id),
      availableBalance: await getAvailableWalletBalance(user.id),
      totalCommissionEarned,
      totalRewardValue,
      accountType: user.accountType,
    },
    investments,
    referralSummary,
    rewardProgress: {
      totalPoints: rewardProgress.totalPoints,
      nextMilestone: rewardProgress.nextMilestone,
      totalClaimedRewardValue: rewardProgress.totalClaimedRewardValue,
      claimableMilestones: rewardProgress.milestones.filter((milestone) => milestone.claimable),
    },
    announcements: await collections.announcements.find({ active: true }).toArray(),
    notifications,
    recentTransactions: walletTransactions.slice(0, 6),
  });
});

app.get("/api/user/join-options", authenticate, async (req: AuthenticatedRequest, res) => {
  const user = await getUserById(req.authUser!.id);
  if (!user) {
    return res.status(404).json({ message: "User not found." });
  }

  return res.json({
    user: await serializeUser(user, req),
    plans: await getActivePlans(),
    settings: await getPublicSettings(),
  });
});

app.get("/api/user/investments", authenticate, async (req: AuthenticatedRequest, res) => {
  const investmentOrders = await getUserInvestmentOrders(req.authUser!.id);
    
  const items = await Promise.all(investmentOrders.map(async (order) => {
    const plan = await getPlanById(order.planId);
    const payment = await collections.paymentSubmissions.findOne({ referenceId: order.id });
    return {
      ...order,
      plan,
      payment: payment ? serializePaymentSubmission(payment as unknown as PaymentSubmission, req) : null,
      metrics: plan ? calculateInvestmentMetrics(order, plan) : null,
    };
  }));

  const sortedItems = items.sort(
    (left: any, right: any) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime()
  );

  return res.json({ 
    items: sortedItems, 
    plans: await getActivePlans(),
  });
});

app.post("/api/user/investments", authenticate, async (req: AuthenticatedRequest, res) => {
  try {
    await runPaymentProofUpload(req, res);
  } catch (error) {
    return respondToUploadError(res, error);
  }

  const request = req as AuthenticatedRequestWithOptionalFile;
  const body = parseSchema(investmentSubmissionSchema, request.body, res);
  if (!body) {
    return;
  }

  if (!hasPaymentProof(body.proofNote, request.file)) {
    return res.status(400).json({
      message: "Add a payment note or upload a proof file before submitting.",
    });
  }

  const user = await getUserById(req.authUser!.id);
  const plan = await getPlanById(body.planId);

  if (!user || !plan) {
    return res.status(404).json({ message: "Selected plan was not found." });
  }

  const duplicateTransaction = await collections.paymentSubmissions.findOne({
    manualTransactionId: body.manualTransactionId.toLowerCase()
  });
  if (duplicateTransaction) {
    return res.status(409).json({ message: "Transaction ID has already been submitted." });
  }

  const createdAt = nowIso();
  const order: InvestmentOrder = {
    id: generateId("INV"),
    userId: user.id,
    planId: plan.id,
    status: "pending",
    createdAt,
    activatedAt: null,
    rejectedAt: null,
  };

  const payment: PaymentSubmission = {
    id: generateId("PAY"),
    userId: user.id,
    channel: "investment",
    amount: plan.price,
    planId: plan.id,
    drawId: null,
    referenceId: order.id,
    manualTransactionId: body.manualTransactionId.trim(),
    proofNote: body.proofNote?.trim() ?? "",
    ...buildStoredProofDetails(request.file),
    status: "pending",
    reviewedByUserId: null,
    reviewNote: "",
    createdAt,
    reviewedAt: null,
  };

  await collections.investmentOrders.insertOne(order);
  await collections.paymentSubmissions.insertOne(payment);
  await addNotification(
    user.id,
    "payment",
    "Investment submitted",
    `${plan.name} payment was submitted and is awaiting admin verification.`,
  );
  await addAuditLog(
    { userId: user.id, email: user.email, role: user.role },
    "INVESTMENT_SUBMITTED",
    "investment",
    order.id,
    { planId: plan.id, paymentId: payment.id },
  );

  return res.status(201).json({
    order,
    payment: serializePaymentSubmission(payment, req),
    plan,
  });
});

app.get("/api/user/lucky-draw", authenticate, async (req: AuthenticatedRequest, res) => {
  const activeDraw = await getActiveDraw();
  const luckyDrawEntries = await collections.luckyDrawEntries.find({ userId: req.authUser!.id }).toArray();
  const items = await Promise.all(luckyDrawEntries.map(async (entry: any) => {
    const draw = await getDrawById(entry.drawId);
    const payment = await collections.paymentSubmissions.findOne({ id: entry.paymentId });
    return {
      ...entry,
      draw,
      payment: payment ? serializePaymentSubmission(payment as any, req) : null,
    };
  }));

  const sortedItems = items.sort(
    (left: any, right: any) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime()
  );

  return res.json({
    activeDraw,
    items: sortedItems,
    totalEntries: luckyDrawEntries.length,
  });
});

app.post("/api/user/lucky-draw-entries", authenticate, async (req: AuthenticatedRequest, res) => {
  try {
    await runPaymentProofUpload(req, res);
  } catch (error) {
    return respondToUploadError(res, error);
  }

  const request = req as AuthenticatedRequestWithOptionalFile;
  const body = parseSchema(luckyDrawEntrySchema, request.body, res);
  if (!body) {
    return;
  }

  if (!hasPaymentProof(body.proofNote, request.file)) {
    return res.status(400).json({
      message: "Add a payment note or upload a proof file before submitting.",
    });
  }

  const user = await getUserById(req.authUser!.id);
  const draw = await getDrawById(body.drawId);

  if (!user || !draw || (draw as any).status !== "open") {
    return res.status(404).json({ message: "Active lucky draw was not found." });
  }

  const duplicateTransaction = await collections.paymentSubmissions.findOne({
    manualTransactionId: body.manualTransactionId.toLowerCase()
  });
  if (duplicateTransaction) {
    return res.status(409).json({ message: "Transaction ID has already been submitted." });
  }

  const createdAt = nowIso();
  const paymentId = generateId("PAY");
  const entry: LuckyDrawEntry = {
    id: generateId("ENT"),
    userId: (user as any).id,
    drawId: (draw as any).id,
    ticketId: generateTicketId(),
    paymentId,
    status: "pending",
    createdAt,
    activatedAt: null,
    rewardAmount: 0,
  };

  const payment: PaymentSubmission = {
    id: paymentId,
    userId: (user as any).id,
    channel: "lucky_draw",
    amount: (draw as any).entryFee,
    planId: null,
    drawId: (draw as any).id,
    referenceId: entry.id,
    manualTransactionId: body.manualTransactionId.trim(),
    proofNote: body.proofNote?.trim() ?? "",
    ...buildStoredProofDetails(request.file),
    status: "pending",
    reviewedByUserId: null,
    reviewNote: "",
    createdAt,
    reviewedAt: null,
  };

  await collections.luckyDrawEntries.insertOne(entry);
  await collections.paymentSubmissions.insertOne(payment);
  await addNotification(
    (user as any).id,
    "payment",
    "Lucky draw entry submitted",
    "Your entry is pending payment verification. A unique ticket has already been reserved for you.",
  );
  await addAuditLog(
    { userId: (user as any).id, email: (user as any).email, role: (user as any).role },
    "LUCKY_DRAW_ENTRY_SUBMITTED",
    "lucky_draw_entry",
    entry.id,
    { drawId: (draw as any).id, paymentId: payment.id, ticketId: entry.ticketId },
  );

  return res.status(201).json({
    entry,
    payment: serializePaymentSubmission(payment, req),
    draw,
  });
});

app.get("/api/user/referrals", authenticate, async (req: AuthenticatedRequest, res) => {
  const user = await getUserById(req.authUser!.id);
  if (!user) {
    return res.status(404).json({ message: "User not found." });
  }

  return res.json({
    user: await serializeUser(user, req),
    settings: (await getPublicSettings()).referralRules,
    summary: await getReferralCounts(user.id),
  });
});

app.get("/api/public/referrals/:referralCode/preview", async (req, res) => {
  const sponsor = (await collections.users.findOne({
    referralCode: req.params.referralCode,
    role: "user",
  })) as unknown as User | null;

  if (!sponsor) {
    return res.status(404).json({ message: "Referral link not found." });
  }

  return res.json({
    sponsor: {
      id: sponsor.id,
      name: sponsor.name,
      referralCode: sponsor.referralCode,
      accountType: sponsor.accountType,
    },
    settings: await getPublicSettings(),
    plans: await getActivePlans(),
    announcements: await collections.announcements.find({ active: true }).toArray(),
  });
});

app.get("/api/user/rewards", authenticate, async (req: AuthenticatedRequest, res) => {
  const user = await getUserById(req.authUser!.id);
  if (!user) {
    return res.status(404).json({ message: "User not found." });
  }

  const [rewardProgress, walletTransactions] = await Promise.all([
    getRewardMilestoneSummary(user.id),
    getWalletTransactionsForUser(user.id),
  ]);

  return res.json({
    totalPoints: rewardProgress.totalPoints,
    totalClaimedRewardValue: rewardProgress.totalClaimedRewardValue,
    milestones: rewardProgress.milestones,
    claims: rewardProgress.claims,
    walletTransactions: walletTransactions.filter((transaction) =>
      ["points_reward", "winner_reward"].includes(transaction.type),
    ),
  });
});

app.post("/api/user/rewards/claim", authenticate, async (req: AuthenticatedRequest, res) => {
  const body = parseSchema(rewardClaimSchema, req.body, res);
  if (!body) {
    return;
  }

  const user = await getUserById(req.authUser!.id);
  if (!user) {
    return res.status(404).json({ message: "User not found." });
  }

  const settings = await getPublicSettings();
  const milestone = settings.rewardMilestones.find(
    (item) => item.pointsRequired === body.pointsRequired,
  );
  if (!milestone) {
    return res.status(404).json({ message: "Reward milestone not found." });
  }

  const rewardProgress = await getRewardMilestoneSummary(user.id);
  if (rewardProgress.totalPoints < milestone.pointsRequired) {
    return res.status(400).json({ message: "You have not reached this milestone yet." });
  }

  const alreadyClaimed = rewardProgress.claims.find(
    (claim) => claim.pointsRequired === milestone.pointsRequired,
  );
  if (alreadyClaimed) {
    return res.status(409).json({ message: "This milestone has already been claimed." });
  }

  const walletTransaction = await addWalletCredit(
    user.id,
    "points_reward",
    milestone.rewardAmount,
    `${milestone.title} reward claimed`,
    String(milestone.pointsRequired),
    "points_milestone",
  );

  const claim: RewardClaim = {
    id: generateId("RWD"),
    userId: user.id,
    pointsRequired: milestone.pointsRequired,
    rewardAmount: milestone.rewardAmount,
    walletTransactionId: walletTransaction.id,
    claimedAt: nowIso(),
  };
  await collections.rewardClaims.insertOne(claim);

  await addNotification(
    user.id,
    "reward",
    `${milestone.title} reward credited`,
    `Your ${milestone.rewardAmount.toLocaleString("en-PK")} PKR milestone reward has been added to your wallet.`,
  );
  await addAuditLog(
    { userId: user.id, email: user.email, role: user.role },
    "POINT_REWARD_CLAIMED",
    "reward_claim",
    claim.id,
    { pointsRequired: milestone.pointsRequired, rewardAmount: milestone.rewardAmount },
  );

  return res.status(201).json({
    claim,
    balance: await getWalletBalance(user.id),
  });
});

app.put("/api/user/profile", authenticate, async (req: AuthenticatedRequest, res) => {
  const body = parseSchema(profileSchema, req.body, res);
  if (!body) {
    return;
  }

  await collections.users.updateOne(
    { id: req.authUser!.id },
    { 
      $set: {
        name: body.name.trim(),
        phone: body.phone.trim(),
        updatedAt: nowIso()
      }
    }
  );

  return res.json({ message: "Profile updated successfully" });
});

app.get("/api/user/notifications", authenticate, async (req: AuthenticatedRequest, res) => {
  const notifications = await collections.notifications
    .find({ userId: req.authUser!.id })
    .sort({ createdAt: -1 })
    .limit(50)
    .toArray();

  return res.json({ items: notifications });
});

app.put("/api/user/notifications/:id/read", authenticate, async (req: AuthenticatedRequest, res) => {
  await collections.notifications.updateOne(
    { 
      id: req.params.id,
      userId: req.authUser!.id 
    },
    { $set: { read: true } }
  );

  return res.json({ message: "Notification marked as read" });
});

app.get("/api/user/wallet", authenticate, async (req: AuthenticatedRequest, res) => {
  const user = await getUserById(req.authUser!.id);
  if (!user) {
    return res.status(404).json({ message: "User not found." });
  }

  const [settings, balance, availableBalance, transactions, withdrawals] = await Promise.all([
    getPublicSettings(),
    getWalletBalance(user.id),
    getAvailableWalletBalance(user.id),
    getWalletTransactionsForUser(user.id),
    collections.withdrawalRequests.find({ userId: user.id }).sort({ createdAt: -1 }).toArray(),
  ]);

  return res.json({
    balance,
    availableBalance,
    reservedAmount: roundCurrency(balance - availableBalance),
    rules: settings.withdrawalRules,
    transactions,
    withdrawals: withdrawals as unknown as WithdrawalRequest[],
  });
});

app.post("/api/user/withdrawals", authenticate, async (req: AuthenticatedRequest, res) => {
  const body = parseSchema(withdrawalRequestSchema, req.body, res);
  if (!body) {
    return;
  }

  const user = await getUserById(req.authUser!.id);
  if (!user) {
    return res.status(404).json({ message: "User not found." });
  }

  const settings = await getPublicSettings();
  if (body.amount < settings.withdrawalRules.minimumAmount) {
    return res.status(400).json({
      message: `Minimum withdrawal is ${settings.withdrawalRules.minimumAmount.toLocaleString("en-PK")} PKR.`,
    });
  }

  if (body.amount > settings.withdrawalRules.dailyLimitMax) {
    return res.status(400).json({
      message: `Daily maximum withdrawal is ${settings.withdrawalRules.dailyLimitMax.toLocaleString("en-PK")} PKR.`,
    });
  }

  const pendingRequest = await collections.withdrawalRequests.findOne({
    userId: user.id,
    status: "pending",
  });
  if (pendingRequest) {
    return res.status(409).json({ message: "You already have a pending withdrawal request." });
  }

  const todayPrefix = nowIso().slice(0, 10);
  const todayRequests = (await collections.withdrawalRequests.find({
    userId: user.id,
    createdAt: { $regex: `^${todayPrefix}` },
    status: { $in: ["pending", "approved"] },
  }).toArray()) as unknown as WithdrawalRequest[];
  const todaysRequestedAmount = todayRequests.reduce((sum, request) => sum + request.amount, 0);
  if (todaysRequestedAmount + body.amount > settings.withdrawalRules.dailyLimitMax) {
    return res.status(400).json({
      message: `Daily withdrawal cap is ${settings.withdrawalRules.dailyLimitMax.toLocaleString("en-PK")} PKR.`,
    });
  }

  const availableBalance = await getAvailableWalletBalance(user.id);
  if (body.amount > availableBalance) {
    return res.status(400).json({ message: "Insufficient available wallet balance." });
  }

  const taxAmount = roundCurrency((body.amount * settings.withdrawalRules.taxPercent) / 100);
  const requestRecord: WithdrawalRequest = {
    id: generateId("WDR"),
    userId: user.id,
    amount: roundCurrency(body.amount),
    taxPercent: settings.withdrawalRules.taxPercent,
    taxAmount,
    netAmount: roundCurrency(body.amount - taxAmount),
    status: "pending",
    note: body.note?.trim() ?? "",
    reviewNote: "",
    createdAt: nowIso(),
    reviewedAt: null,
    reviewedByUserId: null,
  };

  await collections.withdrawalRequests.insertOne(requestRecord);
  await addNotification(
    user.id,
    "withdrawal",
    "Withdrawal request submitted",
    `Your request for ${requestRecord.amount.toLocaleString("en-PK")} PKR is pending review.`,
  );
  await addAuditLog(
    { userId: user.id, email: user.email, role: user.role },
    "WITHDRAWAL_REQUESTED",
    "withdrawal",
    requestRecord.id,
    { amount: requestRecord.amount, netAmount: requestRecord.netAmount },
  );

  return res.status(201).json({ request: requestRecord });
});

app.get("/api/user/transactions", authenticate, async (req: AuthenticatedRequest, res) => {
  const transactions = await getWalletTransactionsForUser(req.authUser!.id);
  
  return res.json({ 
    items: transactions.map(transaction => ({
      ...transaction,
      type:
        transaction.type === "investment_commission" ||
        transaction.type === "lucky_draw_commission"
          ? "referral_commission"
          : transaction.type,
    }))
  });
});

// Admin routes
app.get("/api/admin/dashboard", authenticate, requireAdmin, async (_req, res) => {
  const [rawUsers, rawPayments, rawWalletTransactions, rawRewardClaims, rawWithdrawalRequests, auditLogs] =
    await Promise.all([
      collections.users.find({ role: "user" }).toArray(),
      collections.paymentSubmissions.find({ channel: "investment" }).toArray(),
      collections.walletTransactions.find({}).toArray(),
      collections.rewardClaims.find({}).toArray(),
      collections.withdrawalRequests.find({}).toArray(),
      collections.auditLogs.find({}).limit(10).sort({ createdAt: -1 }).toArray(),
    ]);
  const users = rawUsers as unknown as User[];
  const payments = rawPayments as unknown as PaymentSubmission[];
  const walletTransactions = rawWalletTransactions as unknown as WalletTransaction[];
  const rewardClaims = rawRewardClaims as unknown as RewardClaim[];
  const withdrawalRequests = rawWithdrawalRequests as unknown as WithdrawalRequest[];

  const totalPointsIssued = await Promise.all(users.map((user) => getUserPoints(user.id))).then((totals) =>
    totals.reduce((sum, total) => sum + total, 0),
  );

  const stats = {
    totalUsers: users.length,
    activeMembers: users.filter((user) => user.accountType === "investor" || user.accountType === "hybrid").length,
    pendingPayments: payments.filter((payment) => payment.status === "pending").length,
    pendingWithdrawals: withdrawalRequests.filter((request) => request.status === "pending").length,
    totalInvestmentVolume: payments
      .filter((payment) => payment.status === "approved")
      .reduce((sum, payment) => sum + payment.amount, 0),
    totalReferralCommissions: walletTransactions
      .filter((transaction) =>
        ["referral_commission", "investment_commission", "lucky_draw_commission"].includes(transaction.type),
      )
      .reduce((sum, transaction) => sum + transaction.amount, 0),
    totalRewardClaims: rewardClaims.reduce((sum, claim) => sum + claim.rewardAmount, 0),
    totalWithdrawn: withdrawalRequests
      .filter((request) => request.status === "approved")
      .reduce((sum, request) => sum + request.amount, 0),
    totalPointsIssued,
  };

  const recentPayments = await Promise.all(
    payments
      .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime())
      .slice(0, 5)
      .map(async (payment) => {
        const user = await getUserById(payment.userId);
        const plan = payment.planId ? await getPlanById(payment.planId) : null;
        return {
          id: payment.id,
          amount: payment.amount,
          status: payment.status,
          createdAt: payment.createdAt,
          user: user ? { name: user.name, email: user.email } : null,
          plan: plan ? { name: plan.name, points: plan.points } : null,
        };
      }),
  );

  const recentRewardClaims = await Promise.all(
    rewardClaims
      .sort((left, right) => new Date(right.claimedAt).getTime() - new Date(left.claimedAt).getTime())
      .slice(0, 5)
      .map(async (claim) => {
        const user = await getUserById(claim.userId);
        return {
          id: claim.id,
          rewardAmount: claim.rewardAmount,
          pointsRequired: claim.pointsRequired,
          claimedAt: claim.claimedAt,
          user: user ? { name: user.name, email: user.email } : null,
        };
      }),
  );

  const recentWithdrawals = await Promise.all(
    withdrawalRequests
      .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime())
      .slice(0, 5)
      .map(async (request) => {
        const user = await getUserById(request.userId);
        return {
          id: request.id,
          amount: request.amount,
          netAmount: request.netAmount,
          status: request.status,
          createdAt: request.createdAt,
          user: user ? { name: user.name, email: user.email } : null,
        };
      }),
  );

  return res.json({ stats, recentPayments, recentRewardClaims, recentWithdrawals, auditLogs });
});

app.get("/api/admin/plans", authenticate, requireAdmin, async (_req, res) => {
  return res.json({ items: await getAdminPlans() });
});

app.post("/api/admin/plans", authenticate, requireAdmin, async (req: AuthenticatedRequest, res) => {
  const body = parseSchema(adminPlanSchema, req.body, res);
  if (!body) {
    return;
  }

  const now = nowIso();
  const plan: Plan = {
    id: generateId("PLAN"),
    name: body.name.trim(),
    price: roundCurrency(body.price),
    points: Math.round(body.points),
    benefits: normalizePlanBenefits(body.benefits, Math.round(body.points)),
    featured: body.featured ?? false,
    active: body.active ?? true,
    roiPercent: 0,
    durationDays: 0,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  };

  await collections.plans.insertOne(plan);
  await addAuditLog(
    { userId: req.authUser!.id, email: req.authUser!.email, role: req.authUser!.role },
    "PLAN_CREATED",
    "plan",
    plan.id,
    { name: plan.name, price: plan.price, points: plan.points },
  );

  return res.status(201).json({ plan: await serializeAdminPlan(plan) });
});

app.put("/api/admin/plans/:id", authenticate, requireAdmin, async (req: AuthenticatedRequest, res) => {
  const body = parseSchema(adminPlanSchema, req.body, res);
  if (!body) {
    return;
  }
  const planId = String(req.params.id);

  const existingPlan = await collections.plans.findOne({
    id: planId,
    $or: [{ deletedAt: { $exists: false } }, { deletedAt: null }],
  });
  if (!existingPlan) {
    return res.status(404).json({ message: "Plan not found." });
  }

  const nextPlan = {
    name: body.name.trim(),
    price: roundCurrency(body.price),
    points: Math.round(body.points),
    benefits: normalizePlanBenefits(body.benefits, Math.round(body.points)),
    featured: body.featured ?? false,
    active: body.active ?? true,
    roiPercent: 0,
    durationDays: 0,
    updatedAt: nowIso(),
  };

  await collections.plans.updateOne(
    { id: planId },
    {
      $set: nextPlan,
    },
  );

  await addAuditLog(
    { userId: req.authUser!.id, email: req.authUser!.email, role: req.authUser!.role },
    "PLAN_UPDATED",
    "plan",
    planId,
    { name: nextPlan.name, price: nextPlan.price, points: nextPlan.points },
  );

  const updatedPlan = await collections.plans.findOne({ id: planId });
  return res.json({ plan: await serializeAdminPlan(updatedPlan) });
});

app.delete("/api/admin/plans/:id", authenticate, requireAdmin, async (req: AuthenticatedRequest, res) => {
  const planId = String(req.params.id);
  const existingPlan = await collections.plans.findOne({
    id: planId,
    $or: [{ deletedAt: { $exists: false } }, { deletedAt: null }],
  });
  if (!existingPlan) {
    return res.status(404).json({ message: "Plan not found." });
  }

  const [linkedInvestments, linkedPayments] = await Promise.all([
    collections.investmentOrders.countDocuments({ planId }),
    collections.paymentSubmissions.countDocuments({ planId }),
  ]);

  if (linkedInvestments > 0 || linkedPayments > 0) {
    const archivedAt = nowIso();
    await collections.plans.updateOne(
      { id: planId },
      {
        $set: {
          active: false,
          featured: false,
          deletedAt: archivedAt,
          updatedAt: archivedAt,
        },
      },
    );

    await addAuditLog(
      { userId: req.authUser!.id, email: req.authUser!.email, role: req.authUser!.role },
      "PLAN_ARCHIVED",
      "plan",
      planId,
      { linkedInvestments, linkedPayments },
    );

    return res.json({
      deleted: true,
      archived: true,
      message: "Plan archived because it already has linked investment history.",
    });
  }

  await collections.plans.deleteOne({ id: planId });
  await addAuditLog(
    { userId: req.authUser!.id, email: req.authUser!.email, role: req.authUser!.role },
    "PLAN_DELETED",
    "plan",
    planId,
    {},
  );

  return res.json({ deleted: true, archived: false });
});

app.get("/api/admin/users", authenticate, requireAdmin, async (req, res) => {
  const users = (await collections.users.find({ role: "user" }).sort({ createdAt: -1 }).toArray()) as unknown as User[];
  const items = await Promise.all(
    users.map(async (user) => {
      const serializedUser = await serializeUser(user, req);
      return {
        ...serializedUser,
        activeInvestmentValue: await getUserActiveInvestmentValue(user.id),
        totalPoints: await getUserPoints(user.id),
        referrals: await getReferralCounts(user.id),
      };
    }),
  );

  return res.json({ users: items });
});

app.get("/api/admin/users/:id", authenticate, requireAdmin, async (req, res) => {
  const user = await getUserById(String(req.params.id));

  if (!user || user.role !== "user") {
    return res.status(404).json({ message: "User not found." });
  }

  const investments = await getUserInvestmentOrders(user.id);
  const investmentsWithPlans = await Promise.all(
    investments.map(async (order) => {
      const plan = await getPlanById(order.planId);
      const payment = await collections.paymentSubmissions.findOne({ referenceId: order.id });
      return {
        ...order,
        plan,
        payment: payment ? serializePaymentSubmission(payment as unknown as PaymentSubmission, req) : null,
        metrics: plan ? calculateInvestmentMetrics(order, plan) : null,
      };
    }),
  );

  const luckyDrawEntries = (await collections.luckyDrawEntries.find({ userId: user.id }).sort({ createdAt: -1 }).toArray()) as unknown as LuckyDrawEntry[];
  const entriesWithDetails = await Promise.all(
    luckyDrawEntries.map(async (entry) => ({
      ...entry,
      draw: await getDrawById(entry.drawId),
    })),
  );
  const winnerRecords = await collections.winnerRecords.find({ userId: user.id }).sort({ announcedAt: -1 }).toArray();

  return res.json({
    user: await serializeUser(user, req),
    referrals: await getReferralCounts(user.id),
    investments: investmentsWithPlans,
    entries: entriesWithDetails,
    walletTransactions: await getWalletTransactionsForUser(user.id),
    rewardClaims: await getRewardClaimsForUser(user.id),
    winnerRecords,
    withdrawals: await collections.withdrawalRequests.find({ userId: user.id }).sort({ createdAt: -1 }).toArray(),
    totalPoints: await getUserPoints(user.id),
  });
});

app.get("/api/admin/payments", authenticate, requireAdmin, async (req, res) => {
  const channel = typeof req.query.channel === "string" ? req.query.channel : undefined;
  const payments = (await collections.paymentSubmissions.find(
    channel ? { channel } : {},
  ).sort({ createdAt: -1 }).toArray()) as unknown as PaymentSubmission[];
  
  const items = await Promise.all(payments.map(async (payment) => {
    const user = await getUserById(payment.userId);
    const plan = payment.planId ? await getPlanById(payment.planId) : null;
    const draw = payment.drawId ? await getDrawById(payment.drawId) : null;
    const ticketId = payment.channel === "lucky_draw"
      ? (await collections.luckyDrawEntries.findOne({ id: payment.referenceId }))?.ticketId ?? null
      : null;
    
    return {
      ...serializePaymentSubmission(payment, req),
      user: user ? { id: user.id, name: user.name, email: user.email } : null,
      plan: plan
        ? {
            id: plan.id,
            name: plan.name,
            price: plan.price,
            points: plan.points,
          }
        : null,
      draw,
      ticketId,
    };
  }));

  return res.json({ items });
});

app.put("/api/admin/payments/:id", authenticate, requireAdmin, async (req, res) => {
  const body = parseSchema(paymentDecisionSchema, req.body, res);
  if (!body) {
    return;
  }

  const payment = await collections.paymentSubmissions.findOne({ id: req.params.id });
  if (!payment) {
    return res.status(404).json({ message: "Payment submission not found." });
  }

  const user = await getUserById((payment as any).userId);
  if (!user) {
    return res.status(404).json({ message: "User not found." });
  }

  await collections.paymentSubmissions.updateOne(
    { id: req.params.id },
    { 
      $set: {
        status: body.status,
        reviewNote: body.reviewNote ?? "",
        reviewedAt: nowIso(),
      }
    }
  );

  await addAuditLog(
    { userId: req.authUser!.id, email: req.authUser!.email, role: req.authUser!.role },
    "PAYMENT_REVIEWED",
    "payment_submission",
    payment.id,
    { status: body.status, channel: (payment as any).channel, referenceId: (payment as any).referenceId },
  );

  if (body.status === "approved") {
    if ((payment as any).channel === "investment") {
      const plan = await getPlanById((payment as any).planId);
      if (plan) {
        await collections.investmentOrders.updateOne(
          { id: (payment as any).referenceId },
          { $set: { status: "active", activatedAt: nowIso() } }
        );
        await addNotification(
          (payment as any).userId,
          "payment",
          "Investment approved",
          `${plan.name} is active now. You earned ${plan.points} points toward your reward ranks.`,
        );
        await distributeInvestmentCommissions(user, plan, payment.id);
        await recomputeUserAccountType((payment as any).userId);
      }
    } else if ((payment as any).channel === "lucky_draw") {
      await collections.luckyDrawEntries.updateOne(
        { id: (payment as any).referenceId },
        { $set: { status: "active", activatedAt: nowIso() } }
      );
      await addNotification(
        (payment as any).userId,
        "payment",
        "Lucky draw entry approved",
        "Your lucky draw entry has been activated. Good luck!",
      );
      
      const referrer = await getUserById(user.referredByUserId);
      if (referrer) {
        await addWalletCredit(
          referrer.id,
          "lucky_draw_commission",
          roundCurrency(((payment as any).amount * 5) / 100),
          `Commission from ${user.name}'s lucky draw entry`,
          payment.id,
          "lucky_draw",
        );
      }
      
      await recomputeUserAccountType((payment as any).userId);
    }
  } else {
    if ((payment as any).channel === "investment") {
      await collections.investmentOrders.updateOne(
        { id: (payment as any).referenceId },
        { $set: { status: "rejected", rejectedAt: nowIso() } }
      );
    } else if ((payment as any).channel === "lucky_draw") {
      await collections.luckyDrawEntries.updateOne(
        { id: (payment as any).referenceId },
        { $set: { status: "rejected", rejectedAt: nowIso() } }
      );
    }
  }

  return res.json({
    payment: serializePaymentSubmission(payment as any, req),
    user: await serializeUser(user, req),
  });
});

app.get("/api/admin/draws", authenticate, requireAdmin, async (_req, res) => {
  const draws = await collections.luckyDraws.find({}).toArray();
  
  const drawsWithStats = await Promise.all(draws.map(async (draw: any) => {
    const entries = await collections.luckyDrawEntries.find({ drawId: draw.id }).toArray();
    const activeEntries = entries.filter((entry: any) => entry.status === "active");
    const pendingEntries = entries.filter((entry: any) => entry.status === "pending");
    const rejectedEntries = entries.filter((entry: any) => entry.status === "rejected");
    const winnerEntries = entries.filter((entry: any) => entry.status === "winner");
    
    return {
      ...draw,
      totalEntries: entries.length,
      activeEntries: activeEntries.length,
      pendingEntries: pendingEntries.length,
      rejectedEntries: rejectedEntries.length,
      winners: winnerEntries.length,
    };
  }));

  const rawEntries = (await collections.luckyDrawEntries.find({}).sort({ createdAt: -1 }).toArray()) as unknown as LuckyDrawEntry[];
  const entries = await Promise.all(
    rawEntries.map(async (entry) => {
      const [draw, user, payment] = await Promise.all([
        getDrawById(entry.drawId),
        getUserById(entry.userId),
        collections.paymentSubmissions.findOne({ id: entry.paymentId }),
      ]);
      const typedPayment = payment as unknown as PaymentSubmission | null;

      return {
        id: entry.id,
        ticketId: entry.ticketId,
        status: entry.status,
        rewardAmount: entry.rewardAmount,
        draw: draw ? { id: draw.id, title: draw.title } : null,
        user: user ? { id: user.id, name: user.name, email: user.email } : null,
        payment: typedPayment
          ? {
              id: typedPayment.id,
              status: typedPayment.status,
              manualTransactionId: typedPayment.manualTransactionId,
            }
          : null,
      };
    }),
  );

  return res.json({
    draws: drawsWithStats,
    entries,
  });
});

app.post(
  "/api/admin/draws/:id/winners",
  authenticate,
  requireAdmin,
  async (req: AuthenticatedRequest, res) => {
    const body = parseSchema(winnerSelectionSchema, req.body, res);
    if (!body) {
      return;
    }

    const draw = await getDrawById(String(req.params.id));
    if (!draw) {
      return res.status(404).json({ message: "Lucky draw not found." });
    }

    const actor = req.authUser!;
    const createdWinners: WinnerRecord[] = [];

    for (const entryId of body.entryIds) {
      const entry = await collections.luckyDrawEntries.findOne({ id: entryId, drawId: (draw as any).id });
      if (!entry) {
        return res.status(404).json({ message: `Entry ${entryId} was not found in this draw.` });
      }

      if ((entry as any).status === "winner") {
        continue;
      }

      const user = await getUserById((entry as any).userId);
      if (!user) {
        continue;
      }

      const winner: WinnerRecord = {
        id: generateId("WIN"),
        drawId: (draw as any).id,
        entryId: entry.id,
        userId: (user as any).id,
        rewardAmount: roundCurrency(body.rewardAmount),
        note: body.note,
        announcedByUserId: actor.id,
        announcedAt: nowIso(),
      };

      await collections.luckyDrawEntries.updateOne(
        { id: entry.id },
        { $set: { status: "winner", rewardAmount: winner.rewardAmount } }
      );
      await addWalletCredit(
        (user as any).id,
        "winner_reward",
        winner.rewardAmount,
        `Lucky draw reward credited for ticket ${(entry as any).ticketId}`,
        winner.id,
        "winner_record",
      );
      await addNotification(
        (user as any).id,
        "reward",
        "Lucky draw reward credited",
        `You won Rs ${winner.rewardAmount.toLocaleString()} in ${(draw as any).title}.`,
      );
      await collections.winnerRecords.insertOne(winner);
      await recomputeUserAccountType((user as any).id);
      createdWinners.push(winner);
    }

    await collections.luckyDraws.updateOne(
      { id: (draw as any).id },
      { $set: { status: "completed", updatedAt: nowIso() } }
    );
    await addAuditLog(
      { userId: actor.id, email: actor.email, role: actor.role },
      "DRAW_WINNERS_SELECTED",
      "lucky_draw",
      draw.id,
      { winners: createdWinners.length, rewardAmount: body.rewardAmount },
    );

    return res.status(201).json({
      draw: draw as any,
      winners: createdWinners,
    });
  },
);

app.get("/api/admin/winners", authenticate, requireAdmin, async (_req, res) => {
  const winnerRecords = await collections.winnerRecords.find({}).toArray();
  const items = await Promise.all(winnerRecords.map(async (winner: any) => ({
    ...winner,
    user: await getUserById(winner.userId),
    draw: await getDrawById(winner.drawId),
    entry: await collections.luckyDrawEntries.findOne({ id: winner.entryId }) ?? null,
  })));

  return res.json({ items });
});

app.get("/api/admin/rewards", authenticate, requireAdmin, async (_req, res) => {
  const settings = await getPublicSettings();
  const milestoneTitles = new Map(
    settings.rewardMilestones.map((milestone) => [milestone.pointsRequired, milestone.title]),
  );
  const rewardClaims = (await collections.rewardClaims.find({}).sort({ claimedAt: -1 }).toArray()) as unknown as RewardClaim[];
  const items = await Promise.all(
    rewardClaims.map(async (claim) => {
      const user = await getUserById(claim.userId);
      return {
        ...claim,
        title: milestoneTitles.get(claim.pointsRequired) ?? `${claim.pointsRequired} points`,
        user: user ? { id: user.id, name: user.name, email: user.email } : null,
      };
    }),
  );

  return res.json({ items });
});

app.get("/api/admin/withdrawals", authenticate, requireAdmin, async (_req, res) => {
  const requests = (await collections.withdrawalRequests.find({}).sort({ createdAt: -1 }).toArray()) as unknown as WithdrawalRequest[];
  const items = await Promise.all(
    requests.map(async (request) => {
      const user = await getUserById(request.userId);
      return {
        ...request,
        user: user ? { id: user.id, name: user.name, email: user.email } : null,
      };
    }),
  );

  return res.json({ items });
});

app.patch("/api/admin/withdrawals/:id", authenticate, requireAdmin, async (req, res) => {
  const body = parseSchema(withdrawalDecisionSchema, req.body, res);
  if (!body) {
    return;
  }

  const request = (await collections.withdrawalRequests.findOne({
    id: req.params.id,
  })) as unknown as WithdrawalRequest | null;
  if (!request) {
    return res.status(404).json({ message: "Withdrawal request not found." });
  }

  if (request.status !== "pending") {
    return res.status(409).json({ message: "Withdrawal request is already reviewed." });
  }

  const user = await getUserById(request.userId);
  if (!user) {
    return res.status(404).json({ message: "User not found." });
  }

  if (body.status === "approved") {
    const availableBalance = await getAvailableWalletBalance(user.id);
    if (request.amount > availableBalance) {
      return res.status(400).json({ message: "User no longer has enough available balance." });
    }

    await addWalletDebit(
      user.id,
      "withdrawal",
      request.amount,
      `Withdrawal approved (${request.netAmount.toLocaleString("en-PK")} PKR net after tax)`,
      request.id,
      "withdrawal_request",
    );
    await addNotification(
      user.id,
      "withdrawal",
      "Withdrawal approved",
      `Your withdrawal of ${request.amount.toLocaleString("en-PK")} PKR has been approved.`,
    );
  } else {
    await addNotification(
      user.id,
      "withdrawal",
      "Withdrawal rejected",
      body.reviewNote?.trim() || "Your withdrawal request was rejected by admin.",
    );
  }

  await collections.withdrawalRequests.updateOne(
    { id: request.id },
    {
      $set: {
        status: body.status,
        reviewNote: body.reviewNote?.trim() ?? "",
        reviewedAt: nowIso(),
        reviewedByUserId: req.authUser!.id,
      },
    },
  );

  await addAuditLog(
    { userId: req.authUser!.id, email: req.authUser!.email, role: req.authUser!.role },
    "WITHDRAWAL_REVIEWED",
    "withdrawal",
    request.id,
    { status: body.status, amount: request.amount },
  );

  const updatedRequest = await collections.withdrawalRequests.findOne({ id: request.id });
  return res.json({ request: updatedRequest });
});

app.get("/api/admin/settings", authenticate, requireAdmin, async (_req, res) => {
  const settings = await getPublicSettings();
  const latestAnnouncement = await collections.announcements.findOne({ active: true });
  
  return res.json({
    settings,
    latestAnnouncement,
  });
});

app.put("/api/admin/settings", authenticate, requireAdmin, async (req: AuthenticatedRequest, res) => {
  const body = parseSchema(settingsSchema, req.body, res) as z.infer<typeof settingsSchema> | null;
  if (!body) {
    return;
  }

  await collections.settings.updateOne(
    {},
    {
      $set: normalizeSettings({
        platformName: body.platformName,
        supportEmail: body.supportEmail,
        enableRegistrations: body.enableRegistrations,
        maintenanceMode: body.maintenanceMode,
        paymentDetails: {
          accountName: body.paymentDetails.accountName,
          accountNumber: body.paymentDetails.accountNumber,
          bankName: body.paymentDetails.bankName,
          instructions: body.paymentDetails.instructions,
        },
        referralRules: {
          level1Percent: body.referralRules.level1Percent,
          level2Percent: body.referralRules.level2Percent,
          level3Percent: body.referralRules.level3Percent,
        },
        rewardMilestones: body.rewardMilestones.map((milestone) => ({
          pointsRequired: milestone.pointsRequired,
          rewardAmount: milestone.rewardAmount,
          title: milestone.title,
        })),
        withdrawalRules: {
          minimumAmount: body.withdrawalRules.minimumAmount,
          taxPercent: body.withdrawalRules.taxPercent,
          dailyLimitMin: body.withdrawalRules.dailyLimitMin,
          dailyLimitMax: body.withdrawalRules.dailyLimitMax,
          processingHoursMin: body.withdrawalRules.processingHoursMin,
          processingHoursMax: body.withdrawalRules.processingHoursMax,
        },
      }),
    },
    { upsert: true },
  );

  // Deactivate all announcements and insert new one
  await collections.announcements.updateMany(
    {},
    { $set: { active: false } }
  );
  
  await collections.announcements.insertOne({
    id: generateId("ANN"),
    title: body.announcement.title,
    message: body.announcement.message,
    active: true,
    createdAt: nowIso(),
  });

  await addAuditLog(
    { userId: req.authUser!.id, email: req.authUser!.email, role: req.authUser!.role },
    "SETTINGS_UPDATED",
    "settings",
    "platform",
    { milestoneCount: body.rewardMilestones.length },
  );

  const settings = await getPublicSettings();
  const latestAnnouncement = await collections.announcements.findOne({ active: true });

  return res.json({
    settings,
    latestAnnouncement,
  });
});

app.get("/api/admin/transactions", authenticate, requireAdmin, async (req, res) => {
  const paymentSubmissions = await collections.paymentSubmissions.find({}).toArray();
  const walletTransactions = await collections.walletTransactions.find({}).toArray();
  const withdrawalRequests = await collections.withdrawalRequests.find({}).toArray();
  
  const paymentTransactions = paymentSubmissions.map(async (payment: any) => {
    const user = await getUserById(payment.userId);
    return {
      id: payment.id,
      kind: "payment_submission",
      userId: payment.userId,
      userName: user?.name ?? "Unknown",
      email: user?.email ?? null,
      channel: payment.channel,
      amount: payment.amount,
      status: payment.status,
      createdAt: payment.createdAt,
      note: payment.proofNote,
      proofFileUrl: payment.proofFilePath ? getPublicFileUrl(req, payment.proofFilePath) : null,
      reviewNote: payment.reviewNote,
      referenceId: payment.referenceId,
      referenceType: payment.channel,
    };
  });

  const walletTransactionItems = walletTransactions.map(async (transaction: any) => {
    const user = await getUserById(transaction.userId);
    return {
      id: transaction.id,
      kind: transaction.direction === "debit" ? "wallet_debit" : "wallet_credit",
      userId: transaction.userId,
      userName: user?.name ?? "Unknown",
      email: user?.email ?? null,
      channel: transaction.type,
      amount: transaction.amount,
      status: transaction.direction === "debit" ? "debited" : "credited",
      createdAt: transaction.createdAt,
      note: transaction.description,
      reviewNote: "",
      referenceId: transaction.referenceId,
      referenceType: transaction.referenceType,
    };
  });

  const withdrawalItems = withdrawalRequests.map(async (request: any) => {
    const user = await getUserById(request.userId);
    return {
      id: request.id,
      kind: "withdrawal_request",
      userId: request.userId,
      userName: user?.name ?? "Unknown",
      email: user?.email ?? null,
      channel: "withdrawal",
      amount: request.amount,
      status: request.status,
      createdAt: request.createdAt,
      note: request.note,
      reviewNote: request.reviewNote,
      referenceId: request.id,
      referenceType: "withdrawal_request",
    };
  });

  const allTransactions = await Promise.all([
    ...paymentTransactions,
    ...walletTransactionItems,
    ...withdrawalItems,
  ]);
  const sortedTransactions = allTransactions.sort(
    (left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime()
  );
  
  res.json({ items: sortedTransactions });
});

app.get("/api/admin/audit-logs", authenticate, requireAdmin, async (_req, res) => {
  const auditLogs = await collections.auditLogs.find({}).limit(200).toArray();
  res.json({ items: auditLogs });
});

// Root route for API information
app.get("/", (_req, res) => {
  res.json({
    name: "Nexo Women Earning System API",
    version: "1.0.0",
    status: "running",
    endpoints: {
      auth: {
        register: "POST /api/auth/register",
        login: "POST /api/auth/login",
        me: "GET /api/auth/me",
      },
      user: {
        dashboard: "GET /api/user/dashboard",
        investments: "GET /api/user/investments",
        joinOptions: "GET /api/user/join-options",
        luckyDraw: "GET /api/user/lucky-draw",
        luckyDrawEntries: "POST /api/user/lucky-draw-entries",
        referrals: "GET /api/user/referrals",
        profile: "PUT /api/user/profile",
        notifications: "GET /api/user/notifications",
        markNotificationRead: "PUT /api/user/notifications/:id/read",
        transactions: "GET /api/user/transactions",
      },
      admin: {
        users: "GET /api/admin/users",
        userDetail: "GET /api/admin/users/:id",
        plans: "GET /api/admin/plans",
        createPlan: "POST /api/admin/plans",
        updatePlan: "PUT /api/admin/plans/:id",
        deletePlan: "DELETE /api/admin/plans/:id",
        payments: "GET /api/admin/payments",
        updatePayment: "PUT /api/admin/payments/:id",
        draws: "GET /api/admin/draws",
        selectWinners: "POST /api/admin/draws/:id/winners",
        winners: "GET /api/admin/winners",
        settings: "GET /api/admin/settings",
        updateSettings: "PUT /api/admin/settings",
        transactions: "GET /api/admin/transactions",
        auditLogs: "GET /api/admin/audit-logs",
      },
    },
  });
});

// Start server
async function startServer() {
  await connectToMongoDB();
  
  app.listen(PORT, () => {
    console.log(`🚀 Nexo Backend Server running on port ${PORT}`);
    console.log(`📊 API Documentation: http://localhost:${PORT}/`);
  });
}

startServer().catch(console.error);
