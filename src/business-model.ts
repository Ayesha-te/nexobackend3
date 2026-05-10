export const DEFAULT_INVESTMENT_PLANS = [
  {
    id: "PLAN-1000",
    name: "Starter Queen",
    price: 1000,
    points: 6,
    benefits: [
      "6 reward points on approval",
      "Eligible for 3-level referral income",
      "Start building your earning team",
    ],
    featured: false,
    active: true,
  },
  {
    id: "PLAN-2000",
    name: "Vision Queen",
    price: 2000,
    points: 12,
    benefits: [
      "12 reward points on approval",
      "Build your referral team",
      "Unlock higher level benefits",
    ],
    featured: false,
    active: true,
  },
  {
    id: "PLAN-4000",
    name: "Elevate Queen",
    price: 4000,
    points: 30,
    benefits: [
      "30 reward points on approval",
      "5 course access unlocked",
      "Enhanced commission support",
    ],
    featured: true,
    active: true,
  },
  {
    id: "PLAN-6500",
    name: "Sapphire Queen",
    price: 6500,
    points: 44,
    benefits: [
      "44 reward points on approval",
      "10 courses with priority access",
      "Premium team building support",
    ],
    featured: false,
    active: true,
  },
  {
    id: "PLAN-9500",
    name: "Ruby Queen",
    price: 9500,
    points: 63,
    benefits: [
      "63 reward points on approval",
      "15 courses included",
      "Fastest earning acceleration",
    ],
    featured: false,
    active: true,
  },
  {
    id: "PLAN-12000",
    name: "Diamond Queen",
    price: 12000,
    points: 80,
    benefits: [
      "80 reward points on approval",
      "25 courses with full access",
      "Premium support tier",
    ],
    featured: false,
    active: true,
  },
  {
    id: "PLAN-15000",
    name: "Platinum Queen",
    price: 15000,
    points: 100,
    benefits: [
      "100 reward points on approval",
      "35+ courses with all access",
      "Elite member benefits included",
    ],
    featured: false,
    active: true,
  },
] as const;

export const DEFAULT_REFERRAL_RULES = {
  level1Percent: 48,
  level2Percent: 18,
  level3Percent: 10,
} as const;

export const DEFAULT_REWARD_MILESTONES = [
  { pointsRequired: 1000, rewardAmount: 1500, title: "Starter Rank" },
  { pointsRequired: 2000, rewardAmount: 2500, title: "Bronze Rank" },
  { pointsRequired: 4000, rewardAmount: 4000, title: "Silver Rank" },
  { pointsRequired: 8000, rewardAmount: 6000, title: "Gold Rank" },
  { pointsRequired: 15000, rewardAmount: 8000, title: "Ruby Rank" },
  { pointsRequired: 25000, rewardAmount: 10000, title: "Diamond Rank" },
  { pointsRequired: 40000, rewardAmount: 12000, title: "Platinum Rank" },
  { pointsRequired: 70000, rewardAmount: 15000, title: "Crown Rank" },
  { pointsRequired: 100000, rewardAmount: 18000, title: "Royal Rank" },
] as const;

export const DEFAULT_WITHDRAWAL_RULES = {
  minimumAmount: 1000,
  taxPercent: 10,
  dailyLimitMin: 5000,
  dailyLimitMax: 5000,
  processingHoursMin: 24,
  processingHoursMax: 48,
} as const;
