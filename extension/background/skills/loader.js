// Skill loader — formats skill data for injection into LLM prompts

import { SKILLS } from './index.js';

function getSkillById(id) {
  return SKILLS.find(s => s.id === id) || null;
}

/**
 * Format a skill for injection into a PLAN or CONTINUE prompt.
 * Returns a string block to append to the user message, or empty string if no skill.
 */
export function formatSkillForPrompt(skillId) {
  const skill = getSkillById(skillId);
  if (!skill) return '';

  let block = `\n\nSKILL GUIDE (${skill.name}):\n${skill.body}`;

  if (skill.stop_gates.length > 0) {
    block += `\n\nSTOP GATES — You MUST stop and inform the user before any of these: ${skill.stop_gates.join(', ')}. Do NOT proceed past these points.`;
  }

  if (skill.clarification_points.length > 0) {
    block += '\n\nCLARIFICATION POINTS — Use ask_user when:';
    for (const cp of skill.clarification_points) {
      block += `\n- When ${cp.when}: ask "${cp.ask}"`;
    }
  }

  return block;
}

/**
 * Format skill descriptions for CLASSIFY prompt injection.
 * Returns a string block listing available skills, or empty string if none.
 */
export function formatSkillsForClassify() {
  if (SKILLS.length === 0) return '';

  let block = '\n\nAVAILABLE SKILL GUIDES:\nIf the user\'s request matches one of these skills, you MUST include "skill": "<skill-id>" in your JSON response alongside "escalate": true. Only match if the request clearly relates to the skill.\n\nExample: {"escalate": true, "reason": "multi-step flight booking workflow", "skill": "flight-booking"}\n\nSkills:';
  for (const s of SKILLS) {
    block += `\n- ${s.id}: ${s.description}`;
  }
  return block;
}
