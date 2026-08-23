/* WordRobot 默认配置（教师模式-设置 中可覆盖，存 IndexedDB settings 表） */
window.WR_CONFIG = {
  dictation: { total: 50, c2e: 30, e2c: 20 },
  selection: {
    initial_weight: 1.0,
    wrong_multiplier: 2.0,
    weight_cap: 8.0,
    correct_per_decrease: 3,
    decrease_divisor: 2.0,
    weight_floor: 0.25,
    mastered_threshold: 10
  },
  reward: { milestone_step: 30, big_badge_per: 10 },
  tts: { rate: 0.9 },
  backup: { repo_owner: '', repo_name: '', github_token: '' }
};
