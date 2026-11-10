// One icon per category, used wherever a category is shown and as the last-resort app logo.

import { BadgePercent, Bot, Clapperboard, Cloud, Gamepad2, GraduationCap, HeartPulse, Music, Newspaper, PenTool, Shapes, Smartphone, Terminal, Wifi, type LucideIcon } from 'lucide-react';
import type { Category } from '@/domain/types';

export const CATEGORY_ICON: Record<Category, LucideIcon> = {
  Streaming: Clapperboard,
  Music,
  Productivity: PenTool,
  News: Newspaper,
  Membership: BadgePercent,
  Developer: Terminal,
  Other: Shapes,
  Gaming: Gamepad2,
  AI: Bot,
  Telecom: Smartphone,
  Broadband: Wifi,
  Storage: Cloud,
  Wellness: HeartPulse,
  Learning: GraduationCap,
};
