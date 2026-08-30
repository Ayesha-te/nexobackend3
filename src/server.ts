import dotenv from "dotenv";
import { readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

// Load environment variables
dotenv.config({ path: path.resolve(process.cwd(), '.env') });


import cors from "cors";
import express from "express";
import helmetImport from "helmet";
import jwt from "jsonwebtoken";
import multer from "multer";
import morgan from "morgan";
import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { MongoClient, Db, Collection } from "mongodb";
import {
  DEFAULT_INVESTMENT_PLANS,
  DEFAULT_REFERRAL_RISE_COINS_RULES,
  DEFAULT_REFERRAL_RULES,
  DEFAULT_REFERRAL_TIERS,
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
const MONGODB_URI = process.env.MONGODB_URI?.trim().replace(/^['"]|['"]$/g, "");
console.log("[startup] MONGODB_URI present:", Boolean(MONGODB_URI));
const JWT_SECRET = createHash("sha256")
  .update(`${MONGODB_URI ?? "missing-mongodb-uri"}::nexorise-jwt-secret`)
  .digest("hex");
const DEFAULT_ADMIN_NAME = "NexoRise Platform Admin";
const DEFAULT_ADMIN_EMAIL = "admin@nexorise.com";
const DEFAULT_ADMIN_PHONE = "+92 300 0000000";
const DEFAULT_SUPPORT_EMAIL = "support@nexorise.com";
const DEFAULT_SUPPORT_PHONE_1 = "03448252109";
const DEFAULT_SUPPORT_PHONE_2 = "03057410110";
const DEFAULT_SUPPORT_LOCATION = "Sargodha";
const DEFAULT_ADMIN_PASSWORD = "admin123";
const DEFAULT_PLATFORM_NAME = "NexoRise";
const DEFAULT_ADMIN_WHATSAPP = "03057410110";
const DEFAULT_USD_EXCHANGE_RATE = 280;
const DEFAULT_ACCOUNT_NAME = "Sardar Laeiq Ahmed";
const DEFAULT_ACCOUNT_NUMBER = "03448252109";
const DEFAULT_BANK_NAME = "EasyPaisa";
const DEFAULT_PAYMENT_INSTRUCTIONS =
  "Send payment to this EasyPaisa account and submit your transaction ID or proof screenshot for admin approval.";
const DEFAULT_ANNOUNCEMENT_TITLE = "Join, Build Your Team & Start Earning";
const DEFAULT_ANNOUNCEMENT_MESSAGE =
  "Choose from 800 to 10000 PKR plans, earn 3-step referral income, unlock rewards up to 35,000 PKR, and withdraw from 500 PKR with 10% tax in 24-48 hours.";
const TRAINING_WHATSAPP_CHANNEL_URL =
  "https://whatsapp.com/channel/0029VbClmg56LwHqK2IXYy1Y?utm_source=chatgpt.com";
const IS_VERCEL = Boolean(process.env.VERCEL);

// MongoDB setup
let mongoClient: MongoClient;
let mongoDb: Db;
let collections: {
  users: Collection;
  plans: Collection;
  paymentSubmissions: Collection;
  investmentOrders: Collection;
  walletTransactions: Collection;
  notifications: Collection;
  announcements: Collection;
  auditLogs: Collection;
  settings: Collection;
  rewardClaims: Collection;
  withdrawalRequests: Collection;
  feedbacks: Collection;
  accountCreationRequests: Collection;
  activityFeed: Collection;
  trainingSeatConfirmations: Collection;
};
let mongoConnectPromise: Promise<void> | null = null;
let backendDatabaseReady = false;
let backendDatabaseError: string | null = null;

function setDatabaseUnavailable(message: string) {
  backendDatabaseReady = false;
  backendDatabaseError = message;
  console.warn(`[startup] ${message}`);
}

function isValidMongoUri(uri: string) {
  return uri.startsWith("mongodb://") || uri.startsWith("mongodb+srv://");
}

// Types
type UserRole = "user" | "admin";

// Public self-signup and the lucky draw are both gone: every real user now enters the
// system the same way (an existing member submits an account-creation request, admin
// approves it, and the plan activates immediately), so every user is an "investor" from
// the moment they're created. Kept as a type (rather than inlining the literal) in case a
// future account state is ever needed, but no code path should produce anything else.
type AccountType = "investor";

type UserStatus = "active" | "banned";

type PaymentChannel = "investment";

type PaymentStatus = "pending" | "approved" | "rejected";

type InvestmentStatus = "pending" | "active" | "rejected";

type WalletTransactionType =
  | "investment_commission"
  | "referral_commission"
  | "rise_coins_reward"
  | "withdrawal";

type NotificationType = "system" | "payment" | "commission" | "reward" | "withdrawal";

type WithdrawalRequestStatus = "pending" | "approved" | "rejected";
type WithdrawalAccountType = "easypaisa" | "jazzcash" | "bank_transfer" | "binance";

type PaymentMethodType = "easypaisa" | "jazzcash" | "bank" | "binance";

type AccountRequestStatus = "pending" | "approved" | "rejected";

type ActivityFeedType = "signup" | "withdrawal";

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
  status: UserStatus;
  walletBalance: number;
  createdAt: string;
  updatedAt: string;
  lastLoginAt: string | null;
};

type Plan = {
  id: string;
  name: string;
  price: number;
  riseCoins: number;
  level1Percent: number;
  level2Percent: number;
  level3Percent: number;
  benefits: string[];
  featured: boolean;
  active: boolean;
  roiPercent?: number;
  durationDays?: number;
  createdAt?: string;
  updatedAt?: string;
  deletedAt?: string | null;
};

type PaymentSubmission = {
  id: string;
  userId: string;
  channel: PaymentChannel;
  amount: number;
  planId: string | null;
  referenceId: string;
  manualTransactionId: string;
  proofNote: string;
  proofBase64: string | null;
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
  riseCoinsRequired: number;
  rewardAmount: number;
  title: string;
};

type RewardClaim = {
  id: string;
  userId: string;
  riseCoinsRequired: number;
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
  accountType: WithdrawalAccountType;
  accountDetails: string;
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

type Feedback = {
  id: string;
  userId: string;
  name: string;
  email: string;
  message: string;
  status: "pending" | "read";
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

type PaymentMethod = {
  id: string;
  type: PaymentMethodType;
  label: string;
  accountNumber: string;
  accountHolderName: string;
  bankName?: string;
  extraInstructions: string;
  active: boolean;
};

type Settings = {
  platformName: string;
  supportEmail: string;
  contactDetails: {
    phone1: string;
    phone2: string;
    email: string;
    location: string;
  };
  enableRegistrations: boolean;
  maintenanceMode: boolean;
  paymentMethods: PaymentMethod[];
  adminWhatsApp: string;
  usdExchangeRate: number;
  referralRules: {
    level1Percent: number;
    level2Percent: number;
    level3Percent: number;
  };
  referralRiseCoinsRules: {
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

type AccountCreationRequest = {
  id: string;
  requestedByUserId: string;
  requestedByName: string;
  requestedByEmail: string;
  newMemberName: string;
  newMemberEmail: string;
  newMemberMobile: string;
  planId: string;
  planAmount: number;
  referralCode: string | null;
  resolvedReferrerUserId: string | null;
  paymentNumber: string;
  paymentMethodType: PaymentMethodType | null;
  paymentScreenshotBase64: string;
  paymentScreenshotMimeType: string;
  status: AccountRequestStatus;
  reviewNote: string;
  createdAt: string;
  reviewedAt: string | null;
  reviewedByUserId: string | null;
};

type ActivityFeedEntry = {
  id: string;
  type: ActivityFeedType;
  name: string;
  planAmount?: number;
  method?: string;
  amount?: number;
  createdAt: string;
};

type TrainingSeatConfirmation = {
  id: string;
  userId: string;
  name: string;
  age: number;
  qualification: string;
  agreed: true;
  createdAt: string;
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
app.use(
  cors({
    origin: "*", // Allow all origins
    methods: ["GET", "HEAD", "PUT", "PATCH", "POST", "DELETE", "OPTIONS"],
    allowedHeaders: ["Origin", "X-Requested-With", "Content-Type", "Accept", "Authorization"],
    credentials: false,
    optionsSuccessStatus: 204,
  }),
);

app.use((req, res, next) => {
  if (backendDatabaseReady || req.method === "OPTIONS") {
    next();
    return;
  }

  const publicPaths = new Set(["/", "/api", "/api/health"]);
  if (publicPaths.has(req.path)) {
    next();
    return;
  }

  res.status(503).json({
    message:
      backendDatabaseError ??
      "Backend is running, but MongoDB is not configured or is unavailable.",
  });
});

app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: true, limit: "50mb" }));
app.use(morgan("combined"));
app.use(express.static(path.resolve(process.cwd(), "public")));

// Payment proof / screenshot files are stored as base64 directly in MongoDB (not on disk),
// since Vercel's ephemeral /tmp filesystem loses files on cold start/redeploy.
const upload = multer({
  storage: multer.memoryStorage(),
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
const loginSchema = z.object({
  email: z.string().trim().email(),
  password: z.string().min(6),
});

const investmentSubmissionSchema = z.object({
  planId: z.string().min(1),
  manualTransactionId: z.string().trim().min(1),
  proofNote: z.string().trim().optional(),
});

const paymentDecisionSchema = z.object({
  status: z.enum(["approved", "rejected"]),
  reviewNote: z.string().trim().optional(),
});

const rewardClaimSchema = z.object({
  riseCoinsRequired: z.number().positive(),
});

const withdrawalRequestSchema = z.object({
  amount: z.number().positive(),
  accountType: z.enum(["easypaisa", "jazzcash", "bank_transfer", "binance"]),
  accountDetails: z.string().trim().min(3).max(120),
  note: z.string().trim().optional(),
});

const withdrawalDecisionSchema = z.object({
  status: z.enum(["approved", "rejected"]),
  reviewNote: z.string().trim().optional(),
});

const settingsSchema = z.object({
  platformName: z.string().trim().min(1),
  supportEmail: z.string().trim().email(),
  contactDetails: z.object({
    phone1: z.string().trim().min(3),
    phone2: z.string().trim().min(3),
    email: z.string().trim().email(),
    location: z.string().trim().min(1),
  }),
  enableRegistrations: z.boolean(),
  maintenanceMode: z.boolean(),
  paymentMethods: z
    .array(
      z.object({
        id: z.string().trim().min(1).optional(),
        type: z.enum(["easypaisa", "jazzcash", "bank", "binance"]),
        label: z.string().trim().min(1),
        accountNumber: z.string().trim().default(""),
        accountHolderName: z.string().trim().default(""),
        bankName: z.string().trim().optional().default(""),
        extraInstructions: z.string().trim().optional().default(""),
        active: z.boolean().optional().default(true),
      }),
    )
    .superRefine((methods, ctx) => {
      methods.forEach((method, index) => {
        if (!method.active) {
          return;
        }
        if (!method.accountNumber) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: [index, "accountNumber"],
            message: "Account number is required for an active payment method.",
          });
        }
        if (!method.accountHolderName) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: [index, "accountHolderName"],
            message: "Account holder name is required for an active payment method.",
          });
        }
      });
    }),
  adminWhatsApp: z.string().trim().min(3),
  usdExchangeRate: z.number().positive(),
  referralRules: z.object({
    level1Percent: z.number().min(0).max(100),
    level2Percent: z.number().min(0).max(100),
    level3Percent: z.number().min(0).max(100),
  }),
  referralRiseCoinsRules: z.object({
    level1Percent: z.number().min(0).max(100),
    level2Percent: z.number().min(0).max(100),
    level3Percent: z.number().min(0).max(100),
  }),
  rewardMilestones: z.array(z.object({
    riseCoinsRequired: z.number().positive(),
    rewardAmount: z.number().min(0),
    title: z.string().trim().min(1),
  })).length(DEFAULT_REWARD_MILESTONES.length),
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
  riseCoins: z.number().int().positive(),
  level1Percent: z.number().min(0).max(100),
  level2Percent: z.number().min(0).max(100),
  level3Percent: z.number().min(0).max(100),
  benefits: z.array(z.string().trim()).optional().default([]),
  featured: z.boolean().optional().default(false),
  active: z.boolean().optional().default(true),
});

const profileSchema = z.object({
  name: z.string().trim().min(3),
  phone: z.string().trim().min(10),
});

const passwordChangeSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(6),
});

const feedbackSchema = z.object({
  name: z.string().trim().min(2).max(100),
  message: z.string().trim().min(5).max(5000),
});

const accountRequestSchema = z.object({
  newMemberName: z.string().trim().min(3),
  newMemberEmail: z.string().trim().email(),
  newMemberMobile: z.string().trim().min(10),
  planId: z.string().trim().min(1),
  referralCode: z.string().trim().optional(),
  paymentNumber: z.string().trim().min(3),
  paymentMethodType: z.enum(["easypaisa", "jazzcash", "bank", "binance"]),
});

const adminCreateMemberDirectSchema = z.object({
  newMemberName: z.string().trim().min(3),
  newMemberEmail: z.string().trim().email(),
  newMemberMobile: z.string().trim().min(10),
  planId: z.string().trim().min(1),
  referralCode: z.string().trim().optional(),
});

const accountRequestDecisionSchema = z.object({
  status: z.enum(["approved", "rejected"]),
  reviewNote: z.string().trim().optional(),
});

const adminUserStatusSchema = z.object({
  status: z.enum(["active", "banned"]),
});

const adminUserEditSchema = z.object({
  name: z.string().trim().min(3).optional(),
  email: z.string().trim().email().optional(),
  phone: z.string().trim().min(10).optional(),
});

const trainingSeatConfirmationSchema = z.object({
  name: z.string().trim().min(2),
  age: z.number().int().positive(),
  qualification: z.string().trim().min(1),
});

const resetForLaunchSchema = z.object({
  confirmPassword: z.string().min(1),
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

const NEXORISE_PLAN_PRICE_TIERS = [800, 1200, 1800, 2500, 3500, 4500, 5500, 7000, 8500, 10000];

function getDefaultPlanBenefits(price: number, riseCoins: number) {
  const baseBenefits = [
    `${riseCoins} Rise Coins on approval`,
    "Eligible for 3-level referral income",
    "Counts toward rank rewards",
  ];

  if (price >= 7000) {
    return [...baseBenefits, "Priority support and faster withdrawal review"];
  }
  if (price >= 2500) {
    return [...baseBenefits, "Access to team growth tools"];
  }
  return baseBenefits;
}

function normalizePlanBenefits(benefits: string[] | undefined, riseCoins: number, price = 0) {
  if (NEXORISE_PLAN_PRICE_TIERS.includes(price)) {
    return getDefaultPlanBenefits(price, riseCoins);
  }

  const uniqueBenefits = Array.from(
    new Set(
      (benefits ?? [])
        .map((benefit) => benefit.trim())
        .filter(Boolean),
    ),
  );

  return uniqueBenefits.length > 0 ? uniqueBenefits : getDefaultPlanBenefits(price, riseCoins);
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

function buildDataUri(base64: string | null, mimeType: string | null) {
  if (!base64 || !mimeType) return null;
  return `data:${mimeType};base64,${base64}`;
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
      proofBase64: null,
      proofOriginalFileName: null,
      proofMimeType: null,
    };
  }

  return {
    proofBase64: file.buffer.toString("base64"),
    proofOriginalFileName: file.originalname,
    proofMimeType: file.mimetype,
  };
}

function serializePaymentSubmission(
  payment: PaymentSubmission,
  _req: express.Request | null = null,
) {
  return {
    ...payment,
    proofFileUrl: buildDataUri(payment.proofBase64, payment.proofMimeType),
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

const DEFAULT_PAYMENT_METHODS: PaymentMethod[] = [
  {
    id: "PM-EASYPAISA",
    type: "easypaisa",
    label: "EasyPaisa",
    accountNumber: DEFAULT_ACCOUNT_NUMBER,
    accountHolderName: DEFAULT_ACCOUNT_NAME,
    bankName: "",
    extraInstructions: DEFAULT_PAYMENT_INSTRUCTIONS,
    active: true,
  },
  {
    id: "PM-JAZZCASH",
    type: "jazzcash",
    label: "JazzCash",
    accountNumber: "",
    accountHolderName: "",
    bankName: "",
    extraInstructions: "",
    active: false,
  },
  {
    id: "PM-BANK",
    type: "bank",
    label: "Bank Transfer",
    accountNumber: "",
    accountHolderName: "",
    bankName: "",
    extraInstructions: "",
    active: false,
  },
  {
    id: "PM-BINANCE",
    type: "binance",
    label: "Binance",
    accountNumber: "",
    accountHolderName: "",
    bankName: "",
    extraInstructions: "",
    active: false,
  },
];

function normalizePaymentMethods(paymentMethods?: unknown): PaymentMethod[] {
  if (!Array.isArray(paymentMethods) || paymentMethods.length === 0) {
    return DEFAULT_PAYMENT_METHODS.map((method) => ({ ...method }));
  }

  return paymentMethods.map((raw: any) => ({
    id: typeof raw?.id === "string" && raw.id ? raw.id : generateId("PM"),
    type:
      raw?.type === "easypaisa" || raw?.type === "jazzcash" || raw?.type === "bank" || raw?.type === "binance"
        ? raw.type
        : "easypaisa",
    label: typeof raw?.label === "string" ? raw.label : "",
    accountNumber: typeof raw?.accountNumber === "string" ? raw.accountNumber : "",
    accountHolderName: typeof raw?.accountHolderName === "string" ? raw.accountHolderName : "",
    bankName: typeof raw?.bankName === "string" ? raw.bankName : "",
    extraInstructions: typeof raw?.extraInstructions === "string" ? raw.extraInstructions : "",
    active: raw?.active !== false,
  }));
}

function normalizeSettings(settings?: Partial<Settings> | null): Settings {
  return {
    platformName: settings?.platformName ?? DEFAULT_PLATFORM_NAME,
    supportEmail: settings?.supportEmail ?? DEFAULT_SUPPORT_EMAIL,
    contactDetails: {
      phone1: settings?.contactDetails?.phone1 ?? DEFAULT_SUPPORT_PHONE_1,
      phone2: settings?.contactDetails?.phone2 ?? DEFAULT_SUPPORT_PHONE_2,
      email: settings?.contactDetails?.email ?? DEFAULT_SUPPORT_EMAIL,
      location: settings?.contactDetails?.location ?? DEFAULT_SUPPORT_LOCATION,
    },
    enableRegistrations: settings?.enableRegistrations ?? true,
    maintenanceMode: settings?.maintenanceMode ?? false,
    paymentMethods: normalizePaymentMethods(settings?.paymentMethods),
    adminWhatsApp: settings?.adminWhatsApp ?? DEFAULT_ADMIN_WHATSAPP,
    usdExchangeRate:
      typeof settings?.usdExchangeRate === "number" && settings.usdExchangeRate > 0
        ? settings.usdExchangeRate
        : DEFAULT_USD_EXCHANGE_RATE,
    referralRules: {
      level1Percent:
        settings?.referralRules?.level1Percent ?? DEFAULT_REFERRAL_RULES.level1Percent,
      level2Percent:
        settings?.referralRules?.level2Percent ?? DEFAULT_REFERRAL_RULES.level2Percent,
      level3Percent:
        settings?.referralRules?.level3Percent ?? DEFAULT_REFERRAL_RULES.level3Percent,
    },
    referralRiseCoinsRules: {
      level1Percent:
        settings?.referralRiseCoinsRules?.level1Percent ??
        DEFAULT_REFERRAL_RISE_COINS_RULES.level1Percent,
      level2Percent:
        settings?.referralRiseCoinsRules?.level2Percent ??
        DEFAULT_REFERRAL_RISE_COINS_RULES.level2Percent,
      level3Percent:
        settings?.referralRiseCoinsRules?.level3Percent ??
        DEFAULT_REFERRAL_RISE_COINS_RULES.level3Percent,
    },
    rewardMilestones:
      settings?.rewardMilestones?.length === DEFAULT_REWARD_MILESTONES.length
        ? settings.rewardMilestones
            .map((milestone) => ({
              riseCoinsRequired: Number(milestone.riseCoinsRequired),
              rewardAmount: Number(milestone.rewardAmount),
              title: milestone.title,
            }))
            .sort((left, right) => left.riseCoinsRequired - right.riseCoinsRequired)
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
    riseCoins: Number(plan.riseCoins ?? 0),
    level1Percent: Number(
      typeof plan.level1Percent === "number"
        ? plan.level1Percent
        : DEFAULT_REFERRAL_RULES.level1Percent,
    ),
    level2Percent: Number(
      typeof plan.level2Percent === "number"
        ? plan.level2Percent
        : DEFAULT_REFERRAL_RULES.level2Percent,
    ),
    level3Percent: Number(
      typeof plan.level3Percent === "number"
        ? plan.level3Percent
        : DEFAULT_REFERRAL_RULES.level3Percent,
    ),
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
    benefits: normalizePlanBenefits(plan.benefits, plan.riseCoins, plan.price),
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

async function getUserPersonalRiseCoins(userId: string) {
  const orders = await getUserInvestmentOrders(userId, "active");
  const plans = await Promise.all(orders.map((order) => getPlanById(order.planId)));
  return plans.reduce((sum, plan) => sum + Number(plan?.riseCoins ?? 0), 0);
}

async function getReferralLevelUsers(userId: string) {
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

  return {
    level1Users,
    level2Users,
    level3Users,
  };
}

async function getUserRiseCoinsSummary(userId: string) {
  const [settings, allLevelUsers, personalRiseCoins] = await Promise.all([
    getPublicSettings(),
    getReferralLevelUsers(userId),
    getUserPersonalRiseCoins(userId),
  ]);

  const { level1Users, level2Users, level3Users } = allLevelUsers;

  // Always get level 1 riseCoins (all levels can access 1st level)
  const level1RiseCoinsList = await Promise.all(
    level1Users.map((referral) => getUserPersonalRiseCoins(referral.id))
  );
  const level1RiseCoinsRaw = level1RiseCoinsList.reduce((sum, riseCoins) => sum + riseCoins, 0);
  const level1RiseCoins = Math.floor(
    (level1RiseCoinsRaw * settings.referralRiseCoinsRules.level1Percent) / 100,
  );

  // Always get level 2 riseCoins (levels 1-2 can access up to 2 levels)
  const level2RiseCoinsList = await Promise.all(
    level2Users.map((referral) => getUserPersonalRiseCoins(referral.id))
  );
  const level2RiseCoinsRaw = level2RiseCoinsList.reduce((sum, riseCoins) => sum + riseCoins, 0);
  const level2RiseCoins = Math.floor(
    (level2RiseCoinsRaw * settings.referralRiseCoinsRules.level2Percent) / 100,
  );

  // Preliminary total with 2 levels
  const preliminaryTotal = personalRiseCoins + level1RiseCoins + level2RiseCoins;

  // Check if user qualifies for Level 3 (4000 riseCoins required)
  let level3RiseCoins = 0;
  if (preliminaryTotal >= 4000) {
    const level3RiseCoinsList = await Promise.all(
      level3Users.map((referral) => getUserPersonalRiseCoins(referral.id))
    );
    const level3RiseCoinsRaw = level3RiseCoinsList.reduce((sum, riseCoins) => sum + riseCoins, 0);
    level3RiseCoins = Math.floor(
      (level3RiseCoinsRaw * settings.referralRiseCoinsRules.level3Percent) / 100,
    );
  }

  const referralRiseCoins = level1RiseCoins + level2RiseCoins + level3RiseCoins;

  return {
    personalRiseCoins,
    referralRiseCoins,
    totalRiseCoins: personalRiseCoins + referralRiseCoins,
    referralBreakdown: {
      level1RiseCoins,
      level2RiseCoins,
      level3RiseCoins,
    },
  };
}

async function getUserRiseCoins(userId: string) {
  const summary = await getUserRiseCoinsSummary(userId);
  return summary.totalRiseCoins;
}

async function getUserActiveInvestmentValue(userId: string) {
  const orders = await getUserInvestmentOrders(userId, "active");
  const plans = await Promise.all(orders.map((order) => getPlanById(order.planId)));
  return roundCurrency(plans.reduce((sum, plan) => sum + Number(plan?.price ?? 0), 0));
}

async function hasActiveInvestment(userId: string) {
  const activeInvestmentCount = await collections.investmentOrders.countDocuments({
    userId,
    status: "active",
  });
  return activeInvestmentCount > 0;
}

async function canUserRefer(user: User) {
  if (user.role === "admin") {
    return true;
  }
  return hasActiveInvestment(user.id);
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

function normalizeWithdrawalRequest(raw: any): WithdrawalRequest {
  const accountType: WithdrawalAccountType =
    raw?.accountType === "easypaisa" ||
    raw?.accountType === "jazzcash" ||
    raw?.accountType === "binance"
      ? raw.accountType
      : "bank_transfer";

  return {
    id: String(raw?.id ?? ""),
    userId: String(raw?.userId ?? ""),
    amount: Number(raw?.amount ?? 0),
    taxPercent: Number(raw?.taxPercent ?? 0),
    taxAmount: Number(raw?.taxAmount ?? 0),
    netAmount: Number(raw?.netAmount ?? 0),
    accountType,
    accountDetails: typeof raw?.accountDetails === "string" ? raw.accountDetails : "",
    status: raw?.status === "approved" || raw?.status === "rejected" ? raw.status : "pending",
    note: typeof raw?.note === "string" ? raw.note : "",
    reviewNote: typeof raw?.reviewNote === "string" ? raw.reviewNote : "",
    createdAt: typeof raw?.createdAt === "string" ? raw.createdAt : nowIso(),
    reviewedAt: typeof raw?.reviewedAt === "string" || raw?.reviewedAt === null ? raw.reviewedAt : null,
    reviewedByUserId:
      typeof raw?.reviewedByUserId === "string" || raw?.reviewedByUserId === null
        ? raw.reviewedByUserId
        : null,
  };
}

function getReferralTierByRiseCoins(totalRiseCoins: number) {
  let matched: (typeof DEFAULT_REFERRAL_TIERS)[number] = DEFAULT_REFERRAL_TIERS[0];
  for (const tier of DEFAULT_REFERRAL_TIERS) {
    if (totalRiseCoins >= tier.riseCoinsRequired) {
      matched = tier;
    }
  }
  return matched;
}

async function serializeUser(user: User, req: express.Request | null = null) {
  const sponsor = user.referredByUserId ? await getUserById(user.referredByUserId) : null;
  const referralLinkEnabled = await canUserRefer(user);
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
    referralLinkEnabled,
    referralLink: referralLinkEnabled ? getReferralLink(req, user.referralCode) : null,
    accountType: user.accountType,
    status: user.status ?? "active",
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

async function addActivityFeedEntry(entry: Omit<ActivityFeedEntry, "id" | "createdAt">) {
  const activityFeedEntry: ActivityFeedEntry = {
    id: generateId("ACT"),
    createdAt: nowIso(),
    ...entry,
  };
  await collections.activityFeed.insertOne(activityFeedEntry);
  return activityFeedEntry;
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

async function buildReferralUserRow(referral: User) {
  const [totalRiseCoins, activeInvestmentValue] = await Promise.all([
    getUserPersonalRiseCoins(referral.id),
    getUserActiveInvestmentValue(referral.id),
  ]);
  const tier = getReferralTierByRiseCoins(totalRiseCoins);

  return {
    id: referral.id,
    name: referral.name,
    email: referral.email,
    accountType: referral.accountType,
    joinedAt: referral.createdAt,
    totalRiseCoins,
    activeInvestmentValue,
    rankTitle: tier.title,
    status: activeInvestmentValue > 0 ? "active" : "inactive",
  };
}

async function getReferralCounts(userId: string) {
  const { level1Users, level2Users, level3Users } = await getReferralLevelUsers(userId);

  const [directUsers, level2UserRows, level3UserRows] = await Promise.all([
    Promise.all(level1Users.map((referral) => buildReferralUserRow(referral))),
    Promise.all(level2Users.map((referral) => buildReferralUserRow(referral))),
    Promise.all(level3Users.map((referral) => buildReferralUserRow(referral))),
  ]);

  return {
    level1: level1Users.length,
    level2: level2Users.length,
    level3: level3Users.length,
    directUsers,
    // Indirect team = level 2 + level 3. Exposed both split by level and combined
    // so the frontend can offer a Direct/Indirect toggle (C14).
    level2Users: level2UserRows,
    level3Users: level3UserRows,
    indirectUsers: [...level2UserRows, ...level3UserRows],
  };
}

async function getRewardMilestoneSummary(userId: string) {
  const settings = await getPublicSettings();
  const [totalRiseCoins, claims] = await Promise.all([
    getUserRiseCoins(userId),
    getRewardClaimsForUser(userId),
  ]);

  const claimedRiseCoins = new Set(claims.map((claim) => claim.riseCoinsRequired));
  const milestones = settings.rewardMilestones.map((milestone) => ({
    ...milestone,
    claimed: claimedRiseCoins.has(milestone.riseCoinsRequired),
    claimable:
      milestone.rewardAmount > 0 &&
      totalRiseCoins >= milestone.riseCoinsRequired &&
      !claimedRiseCoins.has(milestone.riseCoinsRequired),
    remainingRiseCoins: Math.max(milestone.riseCoinsRequired - totalRiseCoins, 0),
  }));
  const nextMilestone =
    milestones.find((milestone) => milestone.rewardAmount > 0 && !milestone.claimed) ?? null;

  return {
    totalRiseCoins,
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
  // Determine max upline levels based on user's tier
  // Levels 1-2: 2 steps, Level 3+: 3 steps
  const userRiseCoins = await getUserRiseCoins(user.id);
  const userTier = getReferralTierByRiseCoins(userRiseCoins);
  const maxLevels = userTier.riseCoinsRequired >= 4000 ? 3 : 2; // Level 3 (Elevate) = 4000 riseCoins
  
  const uplines = await getReferralUplines(user, maxLevels);

  for (const { level, user: sponsor } of uplines) {
    const sponsorRiseCoins = await getUserRiseCoins(sponsor.id);
    const sponsorTier = getReferralTierByRiseCoins(sponsorRiseCoins);
    let percentage = 0;
    if (level === 1) {
      percentage = sponsorTier.directPercent;
    } else if (level === 2) {
      percentage = sponsorTier.indirectPercent;
    } else if (level === 3) {
      percentage = sponsorTier.teamPercent;
    }

    if (!percentage || percentage <= 0) continue;

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

// Shared activation path used both by the admin payment-approval flow
// (PUT /api/admin/payments/:id) and the account-creation-request approval flow
// (PATCH /api/admin/account-requests/:id): marks the investment order active,
// notifies the user, and distributes referral Rise Coins/commissions. Every user is
// already "investor" from creation, so there is no account-type recomputation step.
async function activateInvestmentOrder(
  user: User,
  plan: Plan,
  investmentOrderId: string,
  referenceId: string,
) {
  await collections.investmentOrders.updateOne(
    { id: investmentOrderId },
    { $set: { status: "active", activatedAt: nowIso() } },
  );
  await addNotification(
    user.id,
    "payment",
    "Investment approved",
    `${plan.name} has been activated. You earned ${plan.riseCoins} Rise Coins toward your reward ranks.`,
  );
  await distributeInvestmentCommissions(user, plan, referenceId);
}

// Shared account-creation path used both by the account-creation-request approval flow
// (PATCH /api/admin/account-requests/:id) and the admin direct-create flow
// (POST /api/admin/users/create-direct): creates the member's User record, opens their
// investment order for the chosen plan, activates it via activateInvestmentOrder (which
// handles the "Investment approved" notification and referral Rise Coins/commission
// distribution), and posts the same public activity-feed entry as a normal approved signup.
async function createAndActivateMemberAccount(
  details: { name: string; email: string; mobile: string; referredByUserId: string | null },
  plan: Plan,
  referenceId: string,
): Promise<{ user: User; order: InvestmentOrder }> {
  const createdAt = nowIso();
  const newUser: User = {
    id: generateId("USER"),
    role: "user",
    name: details.name,
    email: details.email,
    phone: details.mobile,
    passwordHash: await hashPassword(details.mobile),
    referralCode: generateReferralCode(),
    referredByUserId: details.referredByUserId,
    referralLinkEnabled: true,
    accountType: "investor",
    status: "active",
    walletBalance: 0,
    createdAt,
    updatedAt: createdAt,
    lastLoginAt: null,
  };
  await collections.users.insertOne(newUser);

  const order: InvestmentOrder = {
    id: generateId("INV"),
    userId: newUser.id,
    planId: plan.id,
    status: "pending",
    createdAt,
    activatedAt: null,
    rejectedAt: null,
  };
  await collections.investmentOrders.insertOne(order);

  await activateInvestmentOrder(newUser, plan, order.id, referenceId);

  await addActivityFeedEntry({
    type: "signup",
    name: newUser.name,
    planAmount: plan.price,
  });

  return { user: newUser, order };
}

function calculateInvestmentMetrics(order: InvestmentOrder, plan: Plan) {
  const isActive = order.status === "active";
  return {
    dailyEarning: 0,
    totalReturn: plan.price,
    earned: isActive ? plan.riseCoins : 0,
    remaining: 0,
    daysElapsed: isActive ? 1 : 0,
    durationDays: 1,
    progressPercent: isActive ? 100 : 0,
    riseCoins: plan.riseCoins,
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

function runAccountRequestScreenshotUpload(req: express.Request, res: express.Response) {
  return new Promise<void>((resolve, reject) => {
    upload.single("paymentScreenshot")(req, res, (error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

// MongoDB connection
async function connectToMongoDB() {
  if (mongoConnectPromise) {
    return mongoConnectPromise;
  }

  if (!MONGODB_URI) {
    setDatabaseUnavailable("MONGODB_URI is missing in the hosting environment.");
    mongoConnectPromise = Promise.resolve();
    return;
  }

  if (!isValidMongoUri(MONGODB_URI)) {
    setDatabaseUnavailable(
      'MONGODB_URI must start with "mongodb://" or "mongodb+srv://".',
    );
    mongoConnectPromise = Promise.resolve();
    return;
  }

  mongoConnectPromise = (async () => {
    try {
      mongoClient = new MongoClient(MONGODB_URI);
      await mongoClient.connect();
      mongoDb = mongoClient.db();
      backendDatabaseReady = true;
      backendDatabaseError = null;
    
      // Initialize collections
      collections = {
        users: mongoDb.collection('users'),
        plans: mongoDb.collection('plans'),
        paymentSubmissions: mongoDb.collection('paymentSubmissions'),
        investmentOrders: mongoDb.collection('investmentOrders'),
        walletTransactions: mongoDb.collection('walletTransactions'),
        notifications: mongoDb.collection('notifications'),
        announcements: mongoDb.collection('announcements'),
        auditLogs: mongoDb.collection('auditLogs'),
        settings: mongoDb.collection('settings'),
        rewardClaims: mongoDb.collection('rewardClaims'),
        withdrawalRequests: mongoDb.collection('withdrawalRequests'),
        feedbacks: mongoDb.collection('feedbacks'),
        accountCreationRequests: mongoDb.collection('accountCreationRequests'),
        activityFeed: mongoDb.collection('activityFeed'),
        trainingSeatConfirmations: mongoDb.collection('trainingSeatConfirmations'),
      };

      console.log('Connected to MongoDB Atlas successfully 🚀');
      await initializeDatabase();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to connect to MongoDB Atlas.';
      console.error('Failed to connect to MongoDB Atlas:', error);
      mongoConnectPromise = null;
      setDatabaseUnavailable(message);
    }
  })();

  return mongoConnectPromise;
}

export async function ensureBackendReady() {
  await connectToMongoDB();
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

  // Create default settings
  const defaultSettings: Settings = normalizeSettings({
    platformName: DEFAULT_PLATFORM_NAME,
    supportEmail: DEFAULT_SUPPORT_EMAIL,
    contactDetails: {
      phone1: DEFAULT_SUPPORT_PHONE_1,
      phone2: DEFAULT_SUPPORT_PHONE_2,
      email: DEFAULT_SUPPORT_EMAIL,
      location: DEFAULT_SUPPORT_LOCATION,
    },
    enableRegistrations: false,
    maintenanceMode: false,
    paymentMethods: DEFAULT_PAYMENT_METHODS,
    adminWhatsApp: DEFAULT_ADMIN_WHATSAPP,
    usdExchangeRate: DEFAULT_USD_EXCHANGE_RATE,
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
    status: "active",
    walletBalance: 0,
    createdAt: nowIso(),
    updatedAt: nowIso(),
    lastLoginAt: null,
  };

  // Insert all default data
  await collections.plans.insertMany(defaultPlans);
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
  const seededPlans: Plan[] = DEFAULT_INVESTMENT_PLANS.map((plan) => ({
    ...plan,
    benefits: [...plan.benefits],
    roiPercent: 0,
    durationDays: 0,
    createdAt: nowIso(),
    updatedAt: nowIso(),
    deletedAt: null,
  }));

  const seededPlanIds = seededPlans.map((plan) => plan.id);
  const existingPlans = await collections.plans.find({}).toArray();
  const existingById = new Map<string, any>();

  for (const rawPlan of existingPlans) {
    const id = typeof rawPlan?.id === "string" ? rawPlan.id : "";
    if (id && !existingById.has(id)) {
      existingById.set(id, rawPlan);
    }
  }

  // Enforce the exact 7 poster plans as active plans (upsert by id).
  for (const plan of seededPlans) {
    const existingPlan = existingById.get(plan.id);

    await collections.plans.updateOne(
      { id: plan.id },
      {
        $set: {
          name: plan.name,
          price: plan.price,
          riseCoins: plan.riseCoins,
          level1Percent:
            typeof existingPlan?.level1Percent === "number"
              ? existingPlan.level1Percent
              : plan.level1Percent,
          level2Percent:
            typeof existingPlan?.level2Percent === "number"
              ? existingPlan.level2Percent
              : plan.level2Percent,
          level3Percent:
            typeof existingPlan?.level3Percent === "number"
              ? existingPlan.level3Percent
              : plan.level3Percent,
          benefits: normalizePlanBenefits(plan.benefits, plan.riseCoins, plan.price),
          featured: plan.featured,
          active: true,
          roiPercent: 0,
          durationDays: 0,
          createdAt:
            typeof existingPlan?.createdAt === "string" ? existingPlan.createdAt : nowIso(),
          updatedAt: nowIso(),
          deletedAt: null,
        },
      },
      { upsert: true },
    );
  }

  // Keep legacy plans for historical records but hide them from active plan listings.
  await collections.plans.updateMany(
    {
      id: { $nin: seededPlanIds },
      active: { $ne: false },
      $or: [{ deletedAt: { $exists: false } }, { deletedAt: null }],
    },
    {
      $set: {
        active: false,
        updatedAt: nowIso(),
      },
    },
  );

  // One-time cleanup (runs on every boot): plans that aren't part of the current 10-plan
  // business model accumulate over time (old 7-plan model, admin-created test plans, etc.)
  // and were previously only ever deactivated, never removed -- which is why the admin
  // plan list could balloon well past 10. Hard-delete any non-default plan that has zero
  // investment orders, payment submissions, or account-creation requests referencing it,
  // since there is no history that depends on keeping it around. Plans with history are
  // left as inactive/legacy records.
  const nonDefaultPlans = await collections.plans
    .find({ id: { $nin: seededPlanIds } })
    .project({ id: 1 })
    .toArray();
  for (const rawPlan of nonDefaultPlans) {
    const planId = typeof rawPlan.id === "string" ? rawPlan.id : "";
    if (!planId) continue;

    const [linkedInvestments, linkedPayments, linkedAccountRequests] = await Promise.all([
      collections.investmentOrders.countDocuments({ planId }),
      collections.paymentSubmissions.countDocuments({ planId }),
      collections.accountCreationRequests.countDocuments({ planId }),
    ]);

    if (linkedInvestments === 0 && linkedPayments === 0 && linkedAccountRequests === 0) {
      await collections.plans.deleteOne({ id: planId });
    }
  }

  // Every real user now enters through the account-creation-request approval flow and is
  // an "investor" from creation. Backfill any legacy user left over from a removed flow
  // (self-signup / lucky draw) so no user-facing code path can encounter a stale value.
  await collections.users.updateMany(
    { role: "user", accountType: { $ne: "investor" } },
    { $set: { accountType: "investor", updatedAt: nowIso() } },
  );

  // Backfill the ban/unban `status` field onto any user created before it existed.
  await collections.users.updateMany(
    { status: { $exists: false } },
    { $set: { status: "active" } },
  );

  const currentSettings = (await collections.settings.findOne({})) as
    | (Partial<Settings> & { paymentDetails?: Record<string, string> })
    | null;
  const shouldApplyDefaultPlatformName =
    !currentSettings?.platformName ||
    currentSettings.platformName === "Nexo Investment Platform" ||
    currentSettings.platformName === "Nexo Women Earning System";

  // One-time migration: legacy single `paymentDetails` object -> `paymentMethods` array.
  const legacyPaymentDetails = currentSettings?.paymentDetails;
  const migratedPaymentMethods =
    !currentSettings?.paymentMethods && legacyPaymentDetails
      ? [
          {
            id: "PM-EASYPAISA",
            type: "easypaisa" as const,
            label: legacyPaymentDetails.bankName ?? DEFAULT_BANK_NAME,
            accountNumber: legacyPaymentDetails.accountNumber ?? DEFAULT_ACCOUNT_NUMBER,
            accountHolderName: legacyPaymentDetails.accountName ?? DEFAULT_ACCOUNT_NAME,
            extraInstructions: legacyPaymentDetails.instructions ?? DEFAULT_PAYMENT_INSTRUCTIONS,
            active: true,
          },
          ...DEFAULT_PAYMENT_METHODS.filter((method) => method.type !== "easypaisa"),
        ]
      : currentSettings?.paymentMethods;

  const nextSettings = normalizeSettings({
    ...(currentSettings ?? {}),
    platformName: shouldApplyDefaultPlatformName
      ? DEFAULT_PLATFORM_NAME
      : currentSettings?.platformName,
    contactDetails: {
      phone1: currentSettings?.contactDetails?.phone1 ?? DEFAULT_SUPPORT_PHONE_1,
      phone2: currentSettings?.contactDetails?.phone2 ?? DEFAULT_SUPPORT_PHONE_2,
      email: currentSettings?.contactDetails?.email ?? DEFAULT_SUPPORT_EMAIL,
      location: currentSettings?.contactDetails?.location ?? DEFAULT_SUPPORT_LOCATION,
    },
    paymentMethods: migratedPaymentMethods,
  });
  await collections.settings.updateOne(
    {},
    { $set: nextSettings, $unset: { paymentDetails: "" } },
    { upsert: true },
  );

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
app.get("/", (req, res) => {
  res.json({ message: "Backend is working" });
});

app.get("/api/health", (req, res) => {
  res.json({
    status: "ok",
    database: backendDatabaseReady ? "connected" : "degraded",
    databaseError: backendDatabaseError,
    apiBaseUrl: `${getRequestOrigin(req)}/api`,
  });
});

// Public self-signup has been removed: new member accounts can only be created by an
// existing member via POST /api/user/account-requests, subject to admin approval.
app.post("/api/auth/register", (_req, res) => {
  return res.status(410).json({
    message:
      "Public sign-up is no longer available. Please ask an existing NexoRise member to create your account for you.",
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

  if (user.status === "banned") {
    return res.status(403).json({ message: "This account has been banned. Please contact support." });
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

  const [
    investmentOrders,
    walletTransactions,
    referralSummary,
    rewardProgress,
    notifications,
    settings,
    trainingSeatConfirmation,
  ] =
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
      getPublicSettings(),
      collections.trainingSeatConfirmations.findOne({ userId: user.id }),
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
        ["referral_commission", "investment_commission"].includes(
          transaction.type,
        ) && transaction.referenceType !== "signup_bonus",
      )
      .reduce((sum, transaction) => sum + transaction.amount, 0),
  );
  const totalRewardValue = roundCurrency(
    walletTransactions
      .filter((transaction) => transaction.type === "rise_coins_reward")
      .reduce((sum, transaction) => sum + transaction.amount, 0),
  );

  return res.json({
    user: await serializeUser(user, req),
    stats: {
      totalInvestment,
      totalRiseCoins: rewardProgress.totalRiseCoins,
      walletBalance: await getWalletBalance(user.id),
      availableBalance: await getAvailableWalletBalance(user.id),
      totalCommissionEarned,
      totalRewardValue,
      accountType: user.accountType,
    },
    investments,
    referralSummary,
    referralRules: {
      level1Percent: settings.referralRules.level1Percent,
      level2Percent: settings.referralRules.level2Percent,
      level3Percent: settings.referralRules.level3Percent,
    },
    rewardProgress: {
      totalRiseCoins: rewardProgress.totalRiseCoins,
      nextMilestone: rewardProgress.nextMilestone,
      totalClaimedRewardValue: rewardProgress.totalClaimedRewardValue,
      claimableMilestones: rewardProgress.milestones.filter((milestone) => milestone.claimable),
    },
    announcements: await collections.announcements.find({ active: true }).toArray(),
    notifications,
    recentTransactions: walletTransactions.slice(0, 6),
    trainingSeatConfirmed: Boolean(trainingSeatConfirmation),
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

// New member accounts can only be created by an existing logged-in member submitting a
// request here; the admin reviews and approves/rejects it (see PATCH /api/admin/account-requests/:id).
app.post("/api/user/account-requests", authenticate, async (req: AuthenticatedRequest, res) => {
  try {
    await runAccountRequestScreenshotUpload(req, res);
  } catch (error) {
    return respondToUploadError(res, error);
  }

  const request = req as AuthenticatedRequestWithOptionalFile;
  const body = parseSchema(accountRequestSchema, request.body, res);
  if (!body) {
    return;
  }

  if (!request.file) {
    return res.status(400).json({ message: "Upload a payment screenshot before submitting." });
  }

  const requestedByUser = await getUserById(req.authUser!.id);
  if (!requestedByUser) {
    return res.status(404).json({ message: "User not found." });
  }

  const plan = await getPlanById(body.planId);
  if (!plan) {
    return res.status(404).json({ message: "Selected plan was not found." });
  }

  const existingEmail = await collections.users.findOne({ email: body.newMemberEmail.trim() });
  if (existingEmail) {
    return res.status(409).json({ message: "A member with this email already exists." });
  }

  // A referral code is optional and, per rule, never blocks account creation even when
  // it does not resolve to an existing user -- we just record whatever was given and
  // separately track whether it resolved.
  let resolvedReferrerUserId: string | null = null;
  if (body.referralCode) {
    const referrer = await collections.users.findOne({ referralCode: body.referralCode.trim() });
    if (referrer) {
      resolvedReferrerUserId = (referrer as unknown as User).id;
    }
  }

  const proofDetails = buildStoredProofDetails(request.file);
  const accountRequest: AccountCreationRequest = {
    id: generateId("ACR"),
    requestedByUserId: requestedByUser.id,
    requestedByName: requestedByUser.name,
    requestedByEmail: requestedByUser.email,
    newMemberName: body.newMemberName.trim(),
    newMemberEmail: body.newMemberEmail.trim(),
    newMemberMobile: body.newMemberMobile.trim(),
    planId: plan.id,
    planAmount: plan.price,
    referralCode: body.referralCode?.trim() || null,
    resolvedReferrerUserId,
    paymentNumber: body.paymentNumber.trim(),
    paymentMethodType: body.paymentMethodType,
    paymentScreenshotBase64: proofDetails.proofBase64 ?? "",
    paymentScreenshotMimeType: proofDetails.proofMimeType ?? "",
    status: "pending",
    reviewNote: "",
    createdAt: nowIso(),
    reviewedAt: null,
    reviewedByUserId: null,
  };

  await collections.accountCreationRequests.insertOne(accountRequest);

  const admins = (await collections.users.find({ role: "admin" }).toArray()) as unknown as User[];
  await Promise.all(
    admins.map((admin) =>
      addNotification(
        admin.id,
        "system",
        "New account request",
        `${requestedByUser.name} requested a new member account for ${accountRequest.newMemberName} (${plan.name}).`,
      ),
    ),
  );

  await addAuditLog(
    { userId: requestedByUser.id, email: requestedByUser.email, role: requestedByUser.role },
    "ACCOUNT_REQUEST_SUBMITTED",
    "account_creation_request",
    accountRequest.id,
    { newMemberEmail: accountRequest.newMemberEmail, planId: plan.id },
  );

  const { paymentScreenshotBase64, ...responseRequest } = accountRequest;
  return res.status(201).json({
    request: {
      ...responseRequest,
      paymentScreenshotUrl: buildDataUri(
        accountRequest.paymentScreenshotBase64,
        accountRequest.paymentScreenshotMimeType,
      ),
    },
  });
});

app.get("/api/user/account-requests", authenticate, async (req: AuthenticatedRequest, res) => {
  const items = (await collections.accountCreationRequests
    .find({ requestedByUserId: req.authUser!.id })
    .sort({ createdAt: -1 })
    .toArray()) as unknown as AccountCreationRequest[];

  return res.json({
    items: items.map(({ paymentScreenshotBase64, ...item }) => ({
      ...item,
      paymentScreenshotUrl: buildDataUri(paymentScreenshotBase64, item.paymentScreenshotMimeType),
    })),
  });
});

app.get("/api/user/referrals", authenticate, async (req: AuthenticatedRequest, res) => {
  const user = await getUserById(req.authUser!.id);
  if (!user) {
    return res.status(404).json({ message: "User not found." });
  }

  const [summary, riseCoinsSummary] = await Promise.all([
    getReferralCounts(user.id),
    getUserRiseCoinsSummary(user.id),
  ]);
  const tier = getReferralTierByRiseCoins(riseCoinsSummary.totalRiseCoins);

  return res.json({
    user: await serializeUser(user, req),
    settings: (await getPublicSettings()).referralRules,
    summary,
    rank: {
      totalRiseCoins: riseCoinsSummary.totalRiseCoins,
      personalRiseCoins: riseCoinsSummary.personalRiseCoins,
      referralRiseCoins: riseCoinsSummary.referralRiseCoins,
      referralBreakdown: riseCoinsSummary.referralBreakdown,
      riseCoinsRules: (await getPublicSettings()).referralRiseCoinsRules,
      tier,
      percents: {
        direct: tier.directPercent,
        indirect: tier.indirectPercent,
        team: tier.teamPercent,
      },
    },
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

  if (!(await canUserRefer(sponsor))) {
    return res.status(404).json({ message: "Referral link is not active yet." });
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

app.get("/api/public/site-info", async (_req, res) => {
  const settings = await getPublicSettings();
  return res.json({
    platformName: settings.platformName,
    supportEmail: settings.supportEmail,
    contactDetails: settings.contactDetails,
    adminWhatsApp: settings.adminWhatsApp,
    usdExchangeRate: settings.usdExchangeRate,
    paymentMethods: settings.paymentMethods.filter((method) => method.active),
    referralRules: settings.referralRules,
    referralRiseCoinsRules: settings.referralRiseCoinsRules,
    withdrawalRules: settings.withdrawalRules,
  });
});

// Public: return configured referral tiers (for frontend display)
app.get("/api/public/referral-tiers", async (_req, res) => {
  return res.json({ tiers: DEFAULT_REFERRAL_TIERS });
});

// Public: recent activity feed for the dashboard marquee (signups + withdrawals).
app.get("/api/public/activity-feed", async (_req, res) => {
  const items = await collections.activityFeed
    .find({})
    .sort({ createdAt: -1 })
    .limit(30)
    .toArray();
  return res.json({ items });
});

// Authenticated: return the current user's referral rank (riseCoins + tier + percents)
app.get("/api/user/referral-rank", authenticate, async (req: AuthenticatedRequest, res) => {
  const user = await getUserById(req.authUser!.id);
  if (!user) return res.status(404).json({ message: "User not found." });

  const riseCoinsSummary = await getUserRiseCoinsSummary(user.id);
  const tier = getReferralTierByRiseCoins(riseCoinsSummary.totalRiseCoins);
  const percents = {
    direct: tier.directPercent,
    indirect: tier.indirectPercent,
    team: tier.teamPercent,
  };

  return res.json({
    totalRiseCoins: riseCoinsSummary.totalRiseCoins,
    personalRiseCoins: riseCoinsSummary.personalRiseCoins,
    referralRiseCoins: riseCoinsSummary.referralRiseCoins,
    referralBreakdown: riseCoinsSummary.referralBreakdown,
    tier,
    percents,
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
    totalRiseCoins: rewardProgress.totalRiseCoins,
    totalClaimedRewardValue: rewardProgress.totalClaimedRewardValue,
    milestones: rewardProgress.milestones,
    claims: rewardProgress.claims,
    walletTransactions: walletTransactions.filter((transaction) => transaction.type === "rise_coins_reward"),
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
    (item) => item.riseCoinsRequired === body.riseCoinsRequired,
  );
  if (!milestone) {
    return res.status(404).json({ message: "Reward milestone not found." });
  }
  if (milestone.rewardAmount <= 0) {
    return res.status(400).json({ message: "This milestone does not have a claimable cash reward." });
  }

  const rewardProgress = await getRewardMilestoneSummary(user.id);
  if (rewardProgress.totalRiseCoins < milestone.riseCoinsRequired) {
    return res.status(400).json({ message: "You have not reached this milestone yet." });
  }

  const alreadyClaimed = rewardProgress.claims.find(
    (claim) => claim.riseCoinsRequired === milestone.riseCoinsRequired,
  );
  if (alreadyClaimed) {
    return res.status(409).json({ message: "This milestone has already been claimed." });
  }

  const walletTransaction = await addWalletCredit(
    user.id,
    "rise_coins_reward",
    milestone.rewardAmount,
    `${milestone.title} reward claimed`,
    String(milestone.riseCoinsRequired),
    "rise_coins_milestone",
  );

  const claim: RewardClaim = {
    id: generateId("RWD"),
    userId: user.id,
    riseCoinsRequired: milestone.riseCoinsRequired,
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
    "RISE_COINS_REWARD_CLAIMED",
    "reward_claim",
    claim.id,
    { riseCoinsRequired: milestone.riseCoinsRequired, rewardAmount: milestone.rewardAmount },
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

app.put("/api/user/password", authenticate, async (req: AuthenticatedRequest, res) => {
  const body = parseSchema(passwordChangeSchema, req.body, res);
  if (!body) {
    return;
  }

  const user = await getUserById(req.authUser!.id);
  if (!user) {
    return res.status(404).json({ message: "User not found." });
  }

  if (!(await verifyPassword(body.currentPassword, user.passwordHash))) {
    return res.status(400).json({ message: "Current password is incorrect." });
  }

  const newPasswordHash = await hashPassword(body.newPassword);

  await collections.users.updateOne(
    { id: user.id },
    {
      $set: {
        passwordHash: newPasswordHash,
        updatedAt: nowIso(),
      },
    },
  );

  await addAuditLog(
    { userId: user.id, email: user.email, role: user.role },
    "PASSWORD_CHANGED",
    "user",
    user.id,
  );

  return res.json({ message: "Password updated." });
});

app.post("/api/user/feedback", authenticate, async (req: AuthenticatedRequest, res) => {
  const body = parseSchema(feedbackSchema, req.body, res);
  if (!body) {
    return;
  }

  const user = await getUserById(req.authUser!.id);
  if (!user) {
    return res.status(404).json({ message: "User not found." });
  }

  const feedback: Feedback = {
    id: generateId("FB"),
    userId: user.id,
    name: body.name,
    email: user.email,
    message: body.message,
    status: "pending",
    createdAt: nowIso(),
  };

  await collections.feedbacks.insertOne(feedback);

  return res.json({
    message: "Feedback submitted successfully. Thank you for your feedback!",
    feedback
  });
});

app.post("/api/user/training/confirm-seat", authenticate, async (req: AuthenticatedRequest, res) => {
  const body = parseSchema(trainingSeatConfirmationSchema, req.body, res);
  if (!body) {
    return;
  }

  const user = await getUserById(req.authUser!.id);
  if (!user) {
    return res.status(404).json({ message: "User not found." });
  }

  const confirmation: TrainingSeatConfirmation = {
    id: generateId("TSC"),
    userId: user.id,
    name: body.name.trim(),
    age: body.age,
    qualification: body.qualification.trim(),
    agreed: true,
    createdAt: nowIso(),
  };

  await collections.trainingSeatConfirmations.insertOne(confirmation);
  await addAuditLog(
    { userId: user.id, email: user.email, role: user.role },
    "TRAINING_SEAT_CONFIRMED",
    "training_seat_confirmation",
    confirmation.id,
    {},
  );

  return res.status(201).json({
    message: "Your training seat has been confirmed.",
    confirmation,
    whatsappChannelUrl: TRAINING_WHATSAPP_CHANNEL_URL,
  });
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
    withdrawals: (withdrawals as unknown as any[]).map((item) => normalizeWithdrawalRequest(item)),
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

  if (user.status === "banned") {
    return res.status(403).json({ message: "This account has been banned and cannot submit new withdrawal requests." });
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
    accountType: body.accountType,
    accountDetails: body.accountDetails.trim(),
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
    {
      amount: requestRecord.amount,
      netAmount: requestRecord.netAmount,
      accountType: requestRecord.accountType,
      accountDetails: requestRecord.accountDetails,
    },
  );

  return res.status(201).json({ request: requestRecord });
});

app.get("/api/user/transactions", authenticate, async (req: AuthenticatedRequest, res) => {
  const transactions = await getWalletTransactionsForUser(req.authUser!.id);
  
  return res.json({ 
    items: transactions.map(transaction => ({
      ...transaction,
      type:
        transaction.type === "investment_commission"
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

  const totalRiseCoinsIssued = await Promise.all(users.map((user) => getUserRiseCoins(user.id))).then((totals) =>
    totals.reduce((sum, total) => sum + total, 0),
  );

  const approvedInvestmentVolume = payments
    .filter((payment) => payment.status === "approved")
    .reduce((sum, payment) => sum + payment.amount, 0);
  const pendingWithdrawalAmount = withdrawalRequests
    .filter((request) => request.status === "pending")
    .reduce((sum, request) => sum + request.amount, 0);
  const approvedWithdrawalNetAmount = withdrawalRequests
    .filter((request) => request.status === "approved")
    .reduce((sum, request) => sum + request.netAmount, 0);
  const totalRewardsClaimedAmount = rewardClaims.reduce((sum, claim) => sum + claim.rewardAmount, 0);
  // All credited wallet transactions (referral/investment commissions + Rise Coins reward
  // credits) across every user -- this deliberately excludes deposits, since a plan
  // purchase is never itself a wallet credit, only what it later pays out is.
  const totalEarning = walletTransactions
    .filter((transaction) => transaction.direction === "credit")
    .reduce((sum, transaction) => sum + transaction.amount, 0);

  const stats = {
    totalUsers: users.length,
    activeMembers: users.filter((user) => user.accountType === "investor").length,
    pendingPayments: payments.filter((payment) => payment.status === "pending").length,
    pendingWithdrawals: withdrawalRequests.filter((request) => request.status === "pending").length,
    totalInvestmentVolume: approvedInvestmentVolume,
    // Total money that has come IN via approved plans -- same figure as
    // totalInvestmentVolume above, named to match the "Total Deposit" dashboard tile.
    totalDeposit: approvedInvestmentVolume,
    totalReferralCommissions: walletTransactions
      .filter((transaction) =>
        ["referral_commission", "investment_commission"].includes(
          transaction.type,
        ) && transaction.referenceType !== "signup_bonus",
      )
      .reduce((sum, transaction) => sum + transaction.amount, 0),
    // Sum of all credited wallet transactions across all users (commissions + any other
    // credits), excluding deposits.
    totalEarning,
    totalRewardClaims: totalRewardsClaimedAmount,
    // Reward Box tile: total milestone rewards paid out via rewardClaims.
    totalRewardsClaimed: totalRewardsClaimedAmount,
    totalWithdrawn: withdrawalRequests
      .filter((request) => request.status === "approved")
      .reduce((sum, request) => sum + request.amount, 0),
    // "Pending" tile: sum of amounts on pending withdrawal requests.
    pendingWithdrawalAmount,
    // "Given" tile: sum of netAmount (what was actually paid out) on approved withdrawal requests.
    totalWithdrawnAmount: approvedWithdrawalNetAmount,
    totalRiseCoinsIssued,
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
          plan: plan ? { name: plan.name, riseCoins: plan.riseCoins } : null,
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
          riseCoinsRequired: claim.riseCoinsRequired,
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
          accountType:
            request.accountType === "easypaisa" ||
            request.accountType === "jazzcash" ||
            request.accountType === "bank_transfer" ||
            request.accountType === "binance"
              ? request.accountType
              : "bank_transfer",
          accountDetails:
            typeof request.accountDetails === "string" && request.accountDetails.trim().length > 0
              ? request.accountDetails
              : "-",
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
    riseCoins: Math.round(body.riseCoins),
    level1Percent: Number(body.level1Percent),
    level2Percent: Number(body.level2Percent),
    level3Percent: Number(body.level3Percent),
    benefits: normalizePlanBenefits(body.benefits, Math.round(body.riseCoins), Math.round(body.price)),
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
    {
      name: plan.name,
      price: plan.price,
      riseCoins: plan.riseCoins,
      level1Percent: plan.level1Percent,
      level2Percent: plan.level2Percent,
      level3Percent: plan.level3Percent,
    },
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
    riseCoins: Math.round(body.riseCoins),
    level1Percent: Number(body.level1Percent),
    level2Percent: Number(body.level2Percent),
    level3Percent: Number(body.level3Percent),
    benefits: normalizePlanBenefits(body.benefits, Math.round(body.riseCoins), Math.round(body.price)),
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
    {
      name: nextPlan.name,
      price: nextPlan.price,
      riseCoins: nextPlan.riseCoins,
      level1Percent: nextPlan.level1Percent,
      level2Percent: nextPlan.level2Percent,
      level3Percent: nextPlan.level3Percent,
    },
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

app.get("/api/admin/feedbacks", authenticate, requireAdmin, async (_req, res) => {
  const feedbacks = (await collections.feedbacks
    .find({})
    .sort({ createdAt: -1 })
    .toArray()) as unknown as Feedback[];

  const items = await Promise.all(
    feedbacks.map(async (feedback) => {
      const user = await getUserById(feedback.userId);
      return {
        id: feedback.id,
        name: feedback.name,
        email: feedback.email,
        message: feedback.message,
        status: feedback.status,
        createdAt: feedback.createdAt,
        user: user ? { name: user.name, email: user.email } : null,
      };
    }),
  );

  return res.json({ items });
});

app.put("/api/admin/feedbacks/:id/read", authenticate, requireAdmin, async (req: AuthenticatedRequest, res) => {
  const feedbackId = String(req.params.id);
  const feedback = await collections.feedbacks.findOne({ id: feedbackId });
  
  if (!feedback) {
    return res.status(404).json({ message: "Feedback not found." });
  }

  await collections.feedbacks.updateOne(
    { id: feedbackId },
    { $set: { status: "read" } }
  );

  await addAuditLog(
    { userId: req.authUser!.id, email: req.authUser!.email, role: req.authUser!.role },
    "FEEDBACK_READ",
    "feedback",
    feedbackId,
    { feedbackName: feedback.name },
  );

  return res.json({ message: "Feedback marked as read." });
});

app.get("/api/admin/users", authenticate, requireAdmin, async (req, res) => {
  const search = typeof req.query.search === "string" ? req.query.search.trim() : "";
  const query: Record<string, unknown> = { role: "user" };
  if (search) {
    const searchRegex = new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
    query.$or = [{ name: searchRegex }, { email: searchRegex }, { phone: searchRegex }];
  }

  const users = (await collections.users.find(query).sort({ createdAt: -1 }).toArray()) as unknown as User[];
  const items = await Promise.all(
    users.map(async (user) => {
      const serializedUser = await serializeUser(user, req);
      return {
        ...serializedUser,
        activeInvestmentValue: await getUserActiveInvestmentValue(user.id),
        totalRiseCoins: await getUserRiseCoins(user.id),
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

  return res.json({
    user: await serializeUser(user, req),
    referrals: await getReferralCounts(user.id),
    investments: investmentsWithPlans,
    walletTransactions: await getWalletTransactionsForUser(user.id),
    rewardClaims: await getRewardClaimsForUser(user.id),
    withdrawals: await collections.withdrawalRequests.find({ userId: user.id }).sort({ createdAt: -1 }).toArray(),
    totalRiseCoins: await getUserRiseCoins(user.id),
  });
});

app.patch("/api/admin/users/:id/status", authenticate, requireAdmin, async (req: AuthenticatedRequest, res) => {
  const body = parseSchema(adminUserStatusSchema, req.body, res);
  if (!body) {
    return;
  }

  const user = await getUserById(String(req.params.id));
  if (!user || user.role !== "user") {
    return res.status(404).json({ message: "User not found." });
  }

  // Banning/unbanning only gates login and new withdrawal requests -- wallet balance,
  // transaction history, and referral commission accrual from the user's existing
  // downline are never touched by this.
  await collections.users.updateOne(
    { id: user.id },
    { $set: { status: body.status, updatedAt: nowIso() } },
  );

  await addAuditLog(
    { userId: req.authUser!.id, email: req.authUser!.email, role: req.authUser!.role },
    body.status === "banned" ? "USER_BANNED" : "USER_UNBANNED",
    "user",
    user.id,
    { status: body.status },
  );

  const updatedUser = await getUserById(user.id);
  return res.json({ user: updatedUser ? await serializeUser(updatedUser, req) : null });
});

app.patch("/api/admin/users/:id", authenticate, requireAdmin, async (req: AuthenticatedRequest, res) => {
  const body = parseSchema(adminUserEditSchema, req.body, res);
  if (!body) {
    return;
  }

  if (!body.name && !body.email && !body.phone) {
    return res.status(400).json({ message: "Provide at least one field to update." });
  }

  const user = await getUserById(String(req.params.id));
  if (!user || user.role !== "user") {
    return res.status(404).json({ message: "User not found." });
  }

  const nextEmail = body.email?.trim();
  if (nextEmail && nextEmail !== user.email) {
    const existingEmail = await collections.users.findOne({ email: nextEmail, id: { $ne: user.id } });
    if (existingEmail) {
      return res.status(409).json({ message: "A member with this email already exists." });
    }
  }

  const update: Record<string, unknown> = { updatedAt: nowIso() };
  if (body.name) update.name = body.name.trim();
  if (nextEmail) update.email = nextEmail;
  if (body.phone) update.phone = body.phone.trim();

  await collections.users.updateOne({ id: user.id }, { $set: update });

  await addAuditLog(
    { userId: req.authUser!.id, email: req.authUser!.email, role: req.authUser!.role },
    "USER_UPDATED",
    "user",
    user.id,
    update,
  );

  const updatedUser = await getUserById(user.id);
  return res.json({ user: updatedUser ? await serializeUser(updatedUser, req) : null });
});

app.get("/api/admin/payments", authenticate, requireAdmin, async (req, res) => {
  const channel = typeof req.query.channel === "string" ? req.query.channel : undefined;
  const payments = (await collections.paymentSubmissions.find(
    channel ? { channel } : {},
  ).sort({ createdAt: -1 }).toArray()) as unknown as PaymentSubmission[];
  
  const items = await Promise.all(payments.map(async (payment) => {
    const user = await getUserById(payment.userId);
    const plan = payment.planId ? await getPlanById(payment.planId) : null;

    return {
      ...serializePaymentSubmission(payment, req),
      user: user ? { id: user.id, name: user.name, email: user.email } : null,
      plan: plan
        ? {
            id: plan.id,
            name: plan.name,
            price: plan.price,
            riseCoins: plan.riseCoins,
          }
        : null,
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
        await activateInvestmentOrder(user, plan, (payment as any).referenceId, payment.id);
      }
    }
  } else {
    if ((payment as any).channel === "investment") {
      await collections.investmentOrders.updateOne(
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

app.get("/api/admin/account-requests", authenticate, requireAdmin, async (_req, res) => {
  const items = (await collections.accountCreationRequests
    .find({})
    .sort({ createdAt: -1 })
    .toArray()) as unknown as AccountCreationRequest[];

  return res.json({
    items: items.map(({ paymentScreenshotBase64, ...item }) => ({
      ...item,
      paymentScreenshotUrl: buildDataUri(paymentScreenshotBase64, item.paymentScreenshotMimeType),
    })),
  });
});

app.patch(
  "/api/admin/account-requests/:id",
  authenticate,
  requireAdmin,
  async (req: AuthenticatedRequest, res) => {
    const body = parseSchema(accountRequestDecisionSchema, req.body, res);
    if (!body) {
      return;
    }

    const accountRequest = (await collections.accountCreationRequests.findOne({
      id: req.params.id,
    })) as unknown as AccountCreationRequest | null;
    if (!accountRequest) {
      return res.status(404).json({ message: "Account request not found." });
    }

    if (accountRequest.status !== "pending") {
      return res.status(409).json({ message: "This account request has already been reviewed." });
    }

    if (body.status === "rejected") {
      await collections.accountCreationRequests.updateOne(
        { id: accountRequest.id },
        {
          $set: {
            status: "rejected",
            reviewNote: body.reviewNote?.trim() ?? "",
            reviewedAt: nowIso(),
            reviewedByUserId: req.authUser!.id,
          },
        },
      );
      await addNotification(
        accountRequest.requestedByUserId,
        "system",
        "Account request rejected",
        body.reviewNote?.trim() ||
          `Your request to create an account for ${accountRequest.newMemberName} was rejected.`,
      );
      await addAuditLog(
        { userId: req.authUser!.id, email: req.authUser!.email, role: req.authUser!.role },
        "ACCOUNT_REQUEST_REJECTED",
        "account_creation_request",
        accountRequest.id,
        { reviewNote: body.reviewNote ?? "" },
      );

      const updated = await collections.accountCreationRequests.findOne({ id: accountRequest.id });
      return res.json({ request: updated });
    }

    const plan = await getPlanById(accountRequest.planId);
    if (!plan) {
      return res.status(404).json({ message: "Plan for this request was not found." });
    }

    // Payment was already verified by admin as part of reviewing this request, so the
    // account is created and the investment order activated immediately using the same
    // shared account-creation path (notifications + referral Rise Coins/commission
    // distribution + activity feed) as the admin direct-create flow.
    const { user: newUser } = await createAndActivateMemberAccount(
      {
        name: accountRequest.newMemberName,
        email: accountRequest.newMemberEmail,
        mobile: accountRequest.newMemberMobile,
        referredByUserId: accountRequest.resolvedReferrerUserId,
      },
      plan,
      accountRequest.id,
    );

    await collections.accountCreationRequests.updateOne(
      { id: accountRequest.id },
      {
        $set: {
          status: "approved",
          reviewNote: body.reviewNote?.trim() ?? "",
          reviewedAt: nowIso(),
          reviewedByUserId: req.authUser!.id,
        },
      },
    );

    await addNotification(
      accountRequest.requestedByUserId,
      "system",
      "Account request approved",
      `The account for ${accountRequest.newMemberName} has been created and their ${plan.name} activated.`,
    );

    await addAuditLog(
      { userId: req.authUser!.id, email: req.authUser!.email, role: req.authUser!.role },
      "ACCOUNT_REQUEST_APPROVED",
      "account_creation_request",
      accountRequest.id,
      { newUserId: newUser.id, planId: plan.id },
    );

    const updated = await collections.accountCreationRequests.findOne({ id: accountRequest.id });
    return res.json({ request: updated, user: await serializeUser(newUser, req) });
  },
);

// Lets the admin create and immediately activate a member account directly, without
// routing through an existing member's POST /api/user/account-requests submission. This
// is the only way to create the very first member account after a fresh database wipe
// (or any account without going through another member), since the member-facing login
// blocks admin-role logins and account requests otherwise require an existing member to
// submit them. No payment fields are required -- the admin is directly vouching for the
// account -- so the accountCreationRequests pending-review step is skipped entirely, but
// a record is still inserted (pre-approved, with the admin as both requester and
// reviewer) so this shows up in the Account Requests history for a consistent audit trail.
app.post(
  "/api/admin/users/create-direct",
  authenticate,
  requireAdmin,
  async (req: AuthenticatedRequest, res) => {
    const body = parseSchema(adminCreateMemberDirectSchema, req.body, res);
    if (!body) {
      return;
    }

    const admin = await getUserById(req.authUser!.id);
    if (!admin) {
      return res.status(404).json({ message: "Admin user not found." });
    }

    const plan = await getPlanById(body.planId);
    if (!plan) {
      return res.status(404).json({ message: "Selected plan was not found." });
    }

    const existingEmail = await collections.users.findOne({ email: body.newMemberEmail.trim() });
    if (existingEmail) {
      return res.status(409).json({ message: "A member with this email already exists." });
    }

    // A referral code is optional and, per rule, never blocks account creation even when
    // it does not resolve to an existing user -- we just record whatever was given and
    // separately track whether it resolved.
    let resolvedReferrerUserId: string | null = null;
    if (body.referralCode) {
      const referrer = await collections.users.findOne({ referralCode: body.referralCode.trim() });
      if (referrer) {
        resolvedReferrerUserId = (referrer as unknown as User).id;
      }
    }

    const accountRequest: AccountCreationRequest = {
      id: generateId("ACR"),
      requestedByUserId: admin.id,
      requestedByName: admin.name,
      requestedByEmail: admin.email,
      newMemberName: body.newMemberName.trim(),
      newMemberEmail: body.newMemberEmail.trim(),
      newMemberMobile: body.newMemberMobile.trim(),
      planId: plan.id,
      planAmount: plan.price,
      referralCode: body.referralCode?.trim() || null,
      resolvedReferrerUserId,
      paymentNumber: "",
      paymentMethodType: null,
      paymentScreenshotBase64: "",
      paymentScreenshotMimeType: "",
      status: "approved",
      reviewNote: "Created directly by admin.",
      createdAt: nowIso(),
      reviewedAt: nowIso(),
      reviewedByUserId: admin.id,
    };
    await collections.accountCreationRequests.insertOne(accountRequest);

    // Same shared account-creation path (notifications + referral Rise Coins/commission
    // distribution + activity feed) as the account-creation-request approval flow.
    const { user: newUser } = await createAndActivateMemberAccount(
      {
        name: accountRequest.newMemberName,
        email: accountRequest.newMemberEmail,
        mobile: accountRequest.newMemberMobile,
        referredByUserId: resolvedReferrerUserId,
      },
      plan,
      accountRequest.id,
    );

    await addNotification(
      newUser.id,
      "system",
      "Account created by admin",
      `Your account has been created directly by an administrator and your ${plan.name} activated.`,
    );

    await addAuditLog(
      { userId: admin.id, email: admin.email, role: admin.role },
      "ADMIN_CREATED_MEMBER_DIRECT",
      "user",
      newUser.id,
      { newMemberEmail: newUser.email, planId: plan.id },
    );

    return res.json({ user: await serializeUser(newUser, req) });
  },
);

app.get("/api/admin/rewards", authenticate, requireAdmin, async (_req, res) => {
  const settings = await getPublicSettings();
  const milestoneTitles = new Map(
    settings.rewardMilestones.map((milestone) => [milestone.riseCoinsRequired, milestone.title]),
  );
  const rewardClaims = (await collections.rewardClaims.find({}).sort({ claimedAt: -1 }).toArray()) as unknown as RewardClaim[];
  const items = await Promise.all(
    rewardClaims.map(async (claim) => {
      const user = await getUserById(claim.userId);
      return {
        ...claim,
        title: milestoneTitles.get(claim.riseCoinsRequired) ?? `${claim.riseCoinsRequired} Rise Coins`,
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
      const normalizedRequest = normalizeWithdrawalRequest(request);
      const user = await getUserById(normalizedRequest.userId);
      return {
        ...normalizedRequest,
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
    await addActivityFeedEntry({
      type: "withdrawal",
      name: user.name,
      method: request.accountType,
      amount: request.netAmount,
    });
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
        contactDetails: {
          phone1: body.contactDetails.phone1,
          phone2: body.contactDetails.phone2,
          email: body.contactDetails.email,
          location: body.contactDetails.location,
        },
        enableRegistrations: body.enableRegistrations,
        maintenanceMode: body.maintenanceMode,
        paymentMethods: body.paymentMethods.map((method) => ({
          id: method.id && method.id.length > 0 ? method.id : generateId("PM"),
          type: method.type,
          label: method.label,
          accountNumber: method.accountNumber,
          accountHolderName: method.accountHolderName,
          bankName: method.bankName ?? "",
          extraInstructions: method.extraInstructions ?? "",
          active: method.active ?? true,
        })),
        adminWhatsApp: body.adminWhatsApp,
        usdExchangeRate: body.usdExchangeRate,
        referralRules: {
          level1Percent: body.referralRules.level1Percent,
          level2Percent: body.referralRules.level2Percent,
          level3Percent: body.referralRules.level3Percent,
        },
        referralRiseCoinsRules: {
          level1Percent: body.referralRiseCoinsRules.level1Percent,
          level2Percent: body.referralRiseCoinsRules.level2Percent,
          level3Percent: body.referralRiseCoinsRules.level3Percent,
        },
        rewardMilestones: body.rewardMilestones.map((milestone) => ({
          riseCoinsRequired: milestone.riseCoinsRequired,
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
      proofFileUrl: buildDataUri(payment.proofBase64, payment.proofMimeType),
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

// Irreversible: wipes member/transaction data ahead of a public launch. `settings` and
// `plans` are deliberately left untouched. Requires the calling admin's current password
// as a safeguard against accidental triggering.
app.post(
  "/api/admin/system/reset-for-launch",
  authenticate,
  requireAdmin,
  async (req: AuthenticatedRequest, res) => {
    const body = parseSchema(resetForLaunchSchema, req.body, res);
    if (!body) {
      return;
    }

    const admin = await getUserById(req.authUser!.id);
    if (!admin) {
      return res.status(404).json({ message: "Admin user not found." });
    }

    if (!(await verifyPassword(body.confirmPassword, admin.passwordHash))) {
      return res.status(401).json({ message: "Incorrect password. Reset was not performed." });
    }

    const [
      users,
      paymentSubmissions,
      investmentOrders,
      walletTransactions,
      withdrawalRequests,
      notifications,
      auditLogs,
      rewardClaims,
      accountCreationRequests,
      activityFeed,
      trainingSeatConfirmations,
    ] = await Promise.all([
      collections.users.deleteMany({ role: { $ne: "admin" } }),
      collections.paymentSubmissions.deleteMany({}),
      collections.investmentOrders.deleteMany({}),
      collections.walletTransactions.deleteMany({}),
      collections.withdrawalRequests.deleteMany({}),
      collections.notifications.deleteMany({}),
      collections.auditLogs.deleteMany({}),
      collections.rewardClaims.deleteMany({}),
      collections.accountCreationRequests.deleteMany({}),
      collections.activityFeed.deleteMany({}),
      collections.trainingSeatConfirmations.deleteMany({}),
    ]);

    const deletedCounts = {
      users: users.deletedCount ?? 0,
      paymentSubmissions: paymentSubmissions.deletedCount ?? 0,
      investmentOrders: investmentOrders.deletedCount ?? 0,
      walletTransactions: walletTransactions.deletedCount ?? 0,
      withdrawalRequests: withdrawalRequests.deletedCount ?? 0,
      notifications: notifications.deletedCount ?? 0,
      auditLogs: auditLogs.deletedCount ?? 0,
      rewardClaims: rewardClaims.deletedCount ?? 0,
      accountCreationRequests: accountCreationRequests.deletedCount ?? 0,
      activityFeed: activityFeed.deletedCount ?? 0,
      trainingSeatConfirmations: trainingSeatConfirmations.deletedCount ?? 0,
    };

    // This audit log is written after the wipe (auditLogs was just cleared) so it becomes
    // the first record of the fresh system.
    await addAuditLog(
      { userId: admin.id, email: admin.email, role: admin.role },
      "SYSTEM_RESET_FOR_LAUNCH",
      "system",
      "reset-for-launch",
      deletedCounts,
    );

    return res.json({
      message: "System has been reset for launch. Settings and plans were left untouched.",
      deletedCounts,
    });
  },
);

// Root route for API information
function sendApiInfo(_req: express.Request, res: express.Response) {
  res.json({
    name: "NexoRise API",
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
        referrals: "GET /api/user/referrals",
        profile: "PUT /api/user/profile",
        feedback: "POST /api/user/feedback",
        notifications: "GET /api/user/notifications",
        markNotificationRead: "PUT /api/user/notifications/:id/read",
        transactions: "GET /api/user/transactions",
        accountRequests: "POST /api/user/account-requests",
        myAccountRequests: "GET /api/user/account-requests",
        confirmTrainingSeat: "POST /api/user/training/confirm-seat",
      },
      public: {
        siteInfo: "GET /api/public/site-info",
        referralTiers: "GET /api/public/referral-tiers",
        activityFeed: "GET /api/public/activity-feed",
      },
      admin: {
        users: "GET /api/admin/users",
        userDetail: "GET /api/admin/users/:id",
        updateUserStatus: "PATCH /api/admin/users/:id/status",
        updateUser: "PATCH /api/admin/users/:id",
        plans: "GET /api/admin/plans",
        createPlan: "POST /api/admin/plans",
        updatePlan: "PUT /api/admin/plans/:id",
        deletePlan: "DELETE /api/admin/plans/:id",
        payments: "GET /api/admin/payments",
        updatePayment: "PUT /api/admin/payments/:id",
        feedbacks: "GET /api/admin/feedbacks",
        markFeedbackRead: "PUT /api/admin/feedbacks/:id/read",
        settings: "GET /api/admin/settings",
        updateSettings: "PUT /api/admin/settings",
        transactions: "GET /api/admin/transactions",
        auditLogs: "GET /api/admin/audit-logs",
        accountRequests: "GET /api/admin/account-requests",
        reviewAccountRequest: "PATCH /api/admin/account-requests/:id",
        createMemberDirect: "POST /api/admin/users/create-direct",
        resetForLaunch: "POST /api/admin/system/reset-for-launch",
      },
    },
  });
}

app.get("/", sendApiInfo);
app.get("/api", sendApiInfo);

// Start server
async function startServer() {
  await ensureBackendReady();
  
  app.listen(PORT, () => {
    console.log(`🚀 NexoRise Backend Server running on port ${PORT}`);
    console.log(`📊 API Documentation: http://localhost:${PORT}/`);
  });
}

function isExecutedDirectly() {
  const entryFile = process.argv[1];
  if (!entryFile) {
    return false;
  }

  return import.meta.url === pathToFileURL(entryFile).href;
}

if (isExecutedDirectly()) {
  startServer().catch((error) => {
    console.error("Failed to start backend server:", error);
    process.exitCode = 1;
  });
}

export default app;
