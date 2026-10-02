import {
  Briefcase,
  Bus,
  Car,
  Clapperboard,
  Coffee,
  Dumbbell,
  Gamepad2,
  Gift,
  GraduationCap,
  Heart,
  HeartPulse,
  Home,
  Landmark,
  Laptop,
  MoreHorizontal,
  PiggyBank,
  Plane,
  Repeat,
  Shirt,
  ShoppingBag,
  ShoppingCart,
  TrendingUp,
  Utensils,
  Wallet,
  Wifi,
  Zap,
  type LucideIcon,
} from "lucide-react";

const ICONS: Record<string, LucideIcon> = {
  utensils: Utensils,
  "shopping-cart": ShoppingCart,
  "shopping-bag": ShoppingBag,
  home: Home,
  car: Car,
  bus: Bus,
  "heart-pulse": HeartPulse,
  heart: Heart,
  "graduation-cap": GraduationCap,
  "gamepad-2": Gamepad2,
  coffee: Coffee,
  repeat: Repeat,
  plane: Plane,
  "trending-up": TrendingUp,
  "piggy-bank": PiggyBank,
  wallet: Wallet,
  briefcase: Briefcase,
  zap: Zap,
  wifi: Wifi,
  dumbbell: Dumbbell,
  shirt: Shirt,
  gift: Gift,
  clapperboard: Clapperboard,
  laptop: Laptop,
  landmark: Landmark,
  "more-horizontal": MoreHorizontal,
};

export const CATEGORY_ICONS = Object.keys(ICONS);

interface CategoryIconProps {
  name: string;
  className?: string;
}

export function CategoryIcon({ name, className }: CategoryIconProps) {
  const Icon = ICONS[name] ?? MoreHorizontal;
  return <Icon className={className} aria-hidden="true" />;
}
