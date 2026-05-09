export const DEFAULT_INVESTMENT_PLANS = [
  {
    id: "PLAN-500",
    name: "Starter 500",
    price: 500,
    points: 10,
    benefits: [
      "10 reward points on approval",
      "Eligible for 3-level referral income",
      "Counts toward rank rewards",
    ],
    featured: false,
    active: true,
  },
  {
    id: "PLAN-1500",
    name: "Growth 1500",
    price: 1500,
    points: 15,
    benefits: [
      "15 reward points on approval",
      "Build your referral team",
      "Unlock rank rewards faster",
    ],
    featured: false,
    active: true,
  },
  {
    id: "PLAN-3000",
    name: "Progress 3000",
    price: 3000,
    points: 25,
    benefits: [
      "25 reward points on approval",
      "3-level commission support",
      "Better point acceleration",
    ],
    featured: true,
    active: true,
  },
  {
    id: "PLAN-6000",
    name: "Leader 6000",
    price: 6000,
    points: 40,
    benefits: [
      "40 reward points on approval",
      "Designed for team builders",
      "Strong rank progression",
    ],
    featured: false,
    active: true,
  },
  {
    id: "PLAN-10000",
    name: "Elite 10000",
    price: 10000,
    points: 70,
    benefits: [
      "70 reward points on approval",
      "Highest personal point value",
      "Fastest path to reward ranks",
    ],
    featured: false,
    active: true,
  },
] as const;

export const DEFAULT_REFERRAL_RULES = {
  level1Percent: 30,
  level2Percent: 15,
  level3Percent: 5,
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
  minimumAmount: 1500,
  taxPercent: 10,
  dailyLimitMin: 2000,
  dailyLimitMax: 3000,
  processingHoursMin: 24,
  processingHoursMax: 48,
} as const;
