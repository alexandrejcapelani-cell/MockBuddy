// Seeds a ready-to-take demo mock, so the exam and results pages can be tried without
// calling the model (`npm run db:seed-demo`, while `npm run dev` is running).
//
// Everything is created under the user id "demo-seed", so it never appears in your own
// material list and its chunks never feed your real mocks. Run it again for a fresh copy.

import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { LOCAL_DATABASE_URL } from "../lib/local-db.ts";

const USER = "demo-seed";
const sql = postgres(process.env.DATABASE_URL || LOCAL_DATABASE_URL, { prepare: false, max: 1 });

const chunkText = {
  "OLS assumptions": `Assumptions MLR.1 to MLR.4
MLR.1 Linear in parameters. MLR.2 Random sampling from the population.
MLR.3 No perfect collinearity: no regressor is an exact linear function of the others.
MLR.4 Zero conditional mean: E[u | x1, ..., xk] = 0.
Under MLR.1 to MLR.4 the OLS estimators are unbiased: E[bjhat] = bj.
Variance of the OLS slope
Var(bjhat) = sigma^2 / [ SST_j (1 - R_j^2) ], where R_j^2 is the R-squared from regressing x_j on all other regressors.
A higher R_j^2 (multicollinearity) raises the variance. Multicollinearity does not cause bias; it inflates variance.`,
  "Omitted variable bias": `Omitted variable bias
Suppose the true model is y = b0 + b1 x1 + b2 x2 + u but we regress y on x1 only.
Then E[b1tilde] = b1 + b2 * delta1, where delta1 is the slope from regressing x2 on x1.
The bias term is b2 * delta1. There is no bias if b2 = 0 or if x1 and x2 are uncorrelated.
If b2 > 0 and Corr(x1, x2) > 0: positive (upward) bias.
If b2 < 0 and Corr(x1, x2) > 0: negative bias.`,
  Heteroskedasticity: `Heteroskedasticity: consequences
Heteroskedasticity means Var(u | x) depends on x.
OLS coefficients remain unbiased and consistent under heteroskedasticity.
But the usual standard errors, t statistics and F statistics are invalid, and OLS is no longer BLUE.
Under MLR.1 to MLR.5, OLS is the Best Linear Unbiased Estimator (BLUE).`,
  "Instrumental variables": `Instrumental variables
Relevance: Cov(z, x) is not zero (testable from the first stage).
Exogeneity: Cov(z, u) = 0 (not testable with a single instrument; must be argued).
In simple regression the IV estimator is b1hat_IV = Cov(z, y) / Cov(z, x).
Weak instruments make 2SLS biased towards OLS and give unreliable inference.
Rule of thumb: the first-stage F statistic on the excluded instruments should exceed 10.`,
  "Goodness of fit": `Goodness of fit
R-squared = 1 - SSR / SST: the share of the sample variation in y explained by the regressors.
R-squared never falls when a regressor is added, even an irrelevant one.
Adjusted R-squared penalises extra regressors.`,
};

const mcq = (topic, prompt, options, correct, explanations, why, worked, excerpt) => ({
  type: "mcq",
  topic,
  marks: 2,
  prompt,
  options,
  correctOption: correct,
  optionExplanations: explanations.map((explanation, index) => ({ index, is_correct: index === correct, explanation })),
  correctExplanation: why,
  workedSolution: worked,
  sourceExcerpt: excerpt,
});

const questions = [
  mcq(
    "Heteroskedasticity",
    String.raw`A researcher regresses \(\log(\text{wage})\) on years of education and finds that the spread of the residuals grows with education. Which property of the OLS estimator \(\hat{\beta}_1\) is lost?`,
    ["Unbiasedness", "Being the best linear unbiased estimator (BLUE)", "Consistency", "The fitted line passing through the point of means"],
    1,
    [
      "This confuses unbiasedness with efficiency: unbiasedness needs only MLR.1 to MLR.4, and a non-constant error variance violates none of them.",
      String.raw`Growing residual spread is heteroskedasticity, a failure of MLR.5. The Gauss-Markov theorem needs MLR.5, so OLS stays unbiased but is no longer the minimum-variance linear unbiased estimator.`,
      "This assumes heteroskedasticity damages large-sample properties, but consistency rests on the zero conditional mean assumption, which still holds.",
      "This is a mechanical property of OLS with an intercept and holds whatever the error variance; it has nothing to do with heteroskedasticity.",
    ],
    "The pattern described is heteroskedasticity. The material states that OLS remains unbiased and consistent under heteroskedasticity, but that OLS is no longer BLUE and the usual standard errors are invalid.",
    "Residual spread rising with x means Var(u | x) depends on x, so MLR.5 fails. MLR.1 to MLR.4 still hold, so OLS is still unbiased and consistent; without MLR.5 the Gauss-Markov theorem no longer applies, so OLS is not BLUE.",
    "OLS coefficients remain unbiased and consistent under heteroskedasticity.",
  ),
  mcq(
    "Omitted variable bias",
    String.raw`In the model \(y = \beta_0 + \beta_1 x_1 + \beta_2 x_2 + u\), the variable \(x_2\) is omitted. If \(\beta_2 < 0\) and \(\text{Corr}(x_1, x_2) > 0\), the simple regression estimate \(\tilde{\beta}_1\) is`,
    ["unbiased.", "biased upwards.", "biased downwards.", "biased, in a direction that cannot be determined."],
    2,
    [
      "This would require β₂ = 0 or uncorrelated regressors; here both conditions fail, so the bias term β₂δ₁ is not zero.",
      "This reverses the sign of β₂: an upward bias needs β₂ and the correlation to have the same sign, but here they have opposite signs.",
      String.raw`The bias is \(\beta_2 \delta_1\), and \(\delta_1\) has the sign of the correlation. A negative \(\beta_2\) times a positive \(\delta_1\) is negative, so \(\tilde{\beta}_1\) is biased downwards.`,
      "The direction is fully determined by the signs of β₂ and the correlation, both of which are given.",
    ],
    String.raw`The expected value of the short-regression estimate is \(\beta_1 + \beta_2\delta_1\). With \(\beta_2 < 0\) and \(\delta_1 > 0\), the bias term is negative.`,
    String.raw`\(E[\tilde{\beta}_1] = \beta_1 + \beta_2\delta_1\). The sign of \(\delta_1\) equals the sign of \(\text{Corr}(x_1, x_2)\), which is positive. So \(\beta_2\delta_1 < 0\): downward bias.`,
    "If b2 < 0 and Corr(x1, x2) > 0: negative bias.",
  ),
  mcq(
    "Instrumental variables",
    "A first-stage regression gives an F statistic of 4.1 on the single excluded instrument. What should you conclude?",
    [
      "The instrument is exogenous.",
      "The instrument is weak, so 2SLS is biased towards OLS and its inference is unreliable.",
      "OLS is consistent, so IV is unnecessary.",
      "The model is overidentified.",
    ],
    1,
    [
      "This confuses relevance with exogeneity: the first-stage F measures the instrument's correlation with x, and says nothing about its correlation with u.",
      "An F below the rule-of-thumb threshold of 10 signals a weak instrument, and the material says weak instruments bias 2SLS towards OLS and make inference unreliable.",
      "A weak first stage says nothing about whether x is endogenous; that is a separate question, tested by adding the first-stage residuals to the structural equation.",
      "Overidentification needs more instruments than endogenous regressors; here there is a single instrument.",
    ],
    "The rule of thumb is a first-stage F above 10. At 4.1 the instrument is weak, so 2SLS estimates are pulled towards OLS and the usual inference is unreliable.",
    "Compare 4.1 with the threshold of 10: the instrument fails the rule of thumb, so it is weak.",
    "the first-stage F statistic on the excluded instruments should exceed 10",
  ),
  mcq(
    "Goodness of fit",
    "Adding an irrelevant regressor to a multiple regression will",
    [
      "always raise the adjusted R-squared.",
      "never lower the R-squared.",
      "bias the coefficients on the other regressors.",
      "reduce the variance of the other slope estimates.",
    ],
    1,
    [
      "This confuses the adjusted R-squared with the R-squared: the adjusted measure penalises extra regressors and can fall.",
      "The R-squared cannot fall when a regressor is added, because OLS can always set the new coefficient to zero and fit at least as well as before.",
      "Including an irrelevant variable does not violate MLR.4, so the other estimates stay unbiased.",
      "This reverses the effect: an extra regressor correlated with the others raises their R_j², which increases, not reduces, their variance.",
    ],
    "The material says R-squared never falls when a regressor is added, even an irrelevant one, while adjusted R-squared penalises extra regressors.",
    "Adding a regressor cannot raise the sum of squared residuals, so R² = 1 − SSR/SST cannot fall.",
    "R-squared never falls when a regressor is added, even an irrelevant one.",
  ),
  mcq(
    "OLS assumptions",
    "Which assumption is required for the OLS estimators to be unbiased?",
    [
      "Homoskedasticity of the error term (MLR.5).",
      "Normally distributed errors.",
      String.raw`Zero conditional mean of the error, \(E[u \mid x_1, \dots, x_k] = 0\) (MLR.4).`,
      "A sample size above 30.",
    ],
    2,
    [
      "This confuses the assumptions for unbiasedness with those for the Gauss-Markov theorem: MLR.5 matters for the variance formula, not for unbiasedness.",
      "Normality is needed for exact small-sample t and F distributions, not for OLS to be centred on the true value.",
      "MLR.4 is the assumption that rules out correlation between the regressors and the error; together with MLR.1 to MLR.3 it delivers E[β̂ⱼ] = βⱼ.",
      "Unbiasedness is a finite-sample property under MLR.1 to MLR.4 and holds at any sample size; large samples matter for asymptotic results.",
    ],
    "Under MLR.1 to MLR.4 the OLS estimators are unbiased. Of the options, only the zero conditional mean assumption is one of these four.",
    "List what unbiasedness needs (MLR.1 to MLR.4) and check each option against the list: only MLR.4 appears.",
    "Under MLR.1 to MLR.4 the OLS estimators are unbiased",
  ),
  mcq(
    "Instrumental variables",
    String.raw`With a single instrument \(z\) for an endogenous regressor \(x\), which condition for a valid instrument can be checked from the data?`,
    [
      String.raw`Relevance: \(\text{Cov}(z, x) \neq 0\).`,
      String.raw`Exogeneity: \(\text{Cov}(z, u) = 0\).`,
      "Both relevance and exogeneity.",
      "Neither condition.",
    ],
    0,
    [
      "Relevance is about the observable relationship between z and x, so the first-stage regression tests it directly.",
      "This assumes the error u is observable; it isn't, so with one instrument exogeneity has to be argued, not tested.",
      "Only relevance can be tested; exogeneity is untestable with a single instrument because u is unobserved.",
      "This overlooks the first stage, which tests relevance by checking whether z explains x.",
    ],
    "Relevance is testable from the first stage; exogeneity is not testable with a single instrument and must be argued.",
    "Relevance involves x and z, both observed. Exogeneity involves u, which is not observed, so it cannot be tested with one instrument.",
    "Relevance: Cov(z, x) is not zero (testable from the first stage).",
  ),
  {
    type: "short",
    topic: "OLS assumptions",
    marks: 5,
    prompt: String.raw`Explain why a high correlation between two regressors does not bias the OLS estimates but can make them imprecise. Refer to the formula for \(\text{Var}(\hat{\beta}_j)\).`,
    expectedAnswer: String.raw`Multicollinearity does not violate MLR.1 to MLR.4, so OLS remains unbiased. But \(\text{Var}(\hat{\beta}_j) = \sigma^2 / [SST_j(1 - R_j^2)]\): when \(x_j\) is highly correlated with the other regressors, \(R_j^2\) is close to 1, the denominator is small and the variance is large. The standard errors rise, so the estimates are imprecise.`,
    rubric: [
      { point: "States that OLS stays unbiased because multicollinearity violates none of MLR.1 to MLR.4", marks: 2 },
      { point: String.raw`Uses the variance formula: a high \(R_j^2\) shrinks \(1 - R_j^2\) and raises the variance`, marks: 2 },
      { point: "Concludes that standard errors rise, so the estimates are imprecise", marks: 1 },
    ],
    correctExplanation: "Unbiasedness depends only on MLR.1 to MLR.4, which a high but imperfect correlation leaves intact. Precision depends on the variance formula, in which a high R_j² inflates the variance.",
    workedSolution: String.raw`1. Correlated regressors don't break MLR.1 to MLR.4 (only perfect collinearity breaks MLR.3), so \(E[\hat{\beta}_j] = \beta_j\). 2. In \(\sigma^2/[SST_j(1-R_j^2)]\), \(R_j^2 \to 1\) makes the denominator small. 3. Larger variance means larger standard errors and imprecise estimates.`,
    sourceExcerpt: "Multicollinearity does not cause bias; it inflates variance.",
  },
  {
    type: "short",
    topic: "Omitted variable bias",
    marks: 5,
    prompt: "A study regresses crop yield on fertiliser use. Rainfall raises yield, and farmers use more fertiliser in wetter years. Explain whether omitting rainfall biases the fertiliser coefficient, and in which direction.",
    expectedAnswer: String.raw`Rainfall affects yield (\(\beta_2 > 0\)) and is correlated with fertiliser use, so omitting it biases the fertiliser coefficient. The bias is \(\beta_2\delta_1\), and both \(\beta_2\) and the correlation are positive, so the bias is upward: the effect of fertiliser is overstated.`,
    rubric: [
      { point: "Omitting rainfall biases the estimate because rainfall affects yield and is correlated with fertiliser", marks: 2 },
      { point: String.raw`The bias term \(\beta_2\delta_1\) is positive because both signs are positive`, marks: 2 },
      { point: "So the fertiliser effect is overstated (upward bias)", marks: 1 },
    ],
    correctExplanation: "Both conditions for omitted variable bias hold: rainfall matters for yield and moves with fertiliser. With both signs positive, the bias term is positive.",
    workedSolution: String.raw`\(E[\tilde{\beta}_1] = \beta_1 + \beta_2\delta_1\) with \(\beta_2 > 0\) and \(\delta_1 > 0\), so \(E[\tilde{\beta}_1] > \beta_1\).`,
    sourceExcerpt: "If b2 > 0 and Corr(x1, x2) > 0: positive (upward) bias.",
  },
  {
    type: "numerical",
    topic: "Instrumental variables",
    marks: 5,
    prompt: String.raw`In a simple IV regression, the sample covariance between the instrument \(z\) and \(y\) is 0.84 and the sample covariance between \(z\) and \(x\) is 0.35. Compute \(\hat{\beta}_{1,IV}\) to two decimal places.`,
    numericAnswer: 2.4,
    tolerance: 0.005,
    unit: null,
    correctExplanation: String.raw`In simple regression the IV estimator is the ratio \(\text{Cov}(z, y)/\text{Cov}(z, x)\).`,
    workedSolution: String.raw`\(\hat{\beta}_{1,IV} = 0.84 / 0.35 = 2.40\).`,
    sourceExcerpt: "In simple regression the IV estimator is b1hat_IV = Cov(z, y) / Cov(z, x).",
  },
  {
    type: "numerical",
    topic: "Omitted variable bias",
    marks: 5,
    prompt: String.raw`The true model is \(y = \beta_0 + 0.5x_1 + 0.3x_2 + u\), and regressing \(x_2\) on \(x_1\) gives a slope \(\tilde{\delta}_1 = 0.4\). If \(x_2\) is omitted, what is \(E[\tilde{\beta}_1]\)? Give two decimal places.`,
    numericAnswer: 0.62,
    tolerance: 0.005,
    unit: null,
    correctExplanation: String.raw`The short-regression slope is centred on \(\beta_1 + \beta_2\delta_1\), the true effect plus the omitted variable bias.`,
    workedSolution: String.raw`\(E[\tilde{\beta}_1] = 0.5 + 0.3 \times 0.4 = 0.5 + 0.12 = 0.62\).`,
    sourceExcerpt: "Then E[b1tilde] = b1 + b2 * delta1",
  },
];

const sections = [
  { name: "Section A", question_type: "mcq", proportion: 0.6, marks_each: 2, style_notes: "Four options; conceptual checks on OLS assumptions, bias direction and instruments.", observed_difficulty: "medium" },
  { name: "Section B", question_type: "short", proportion: 0.2, marks_each: 5, style_notes: "Explain a mechanism with reference to a formula or a scenario.", observed_difficulty: "medium" },
  { name: "Section B", question_type: "numerical", proportion: 0.2, marks_each: 5, style_notes: "Compute one estimate from given numbers to two decimal places.", observed_difficulty: "medium" },
];

await sql.begin(async (tx) => {
  const [material] = await tx`
    insert into materials (user_id, filename, storage_path, page_count, status)
    values (${USER}, 'Seeded econometrics notes (demo)', ${`${USER}/materials/${randomUUID()}/seed.txt`}, null, 'chunked')
    returning id`;
  const chunkIds = {};
  let ordinal = 1;
  for (const [topic, content] of Object.entries(chunkText)) {
    const [chunk] = await tx`
      insert into chunks (material_id, ordinal, section_label, topic_label, content, token_estimate)
      values (${material.id}, ${ordinal}, ${`Part ${ordinal} · ${topic}`}, ${topic}, ${content}, ${Math.ceil(content.length / 4)})
      returning id`;
    chunkIds[topic] = chunk.id;
    ordinal++;
  }

  const [blueprint] = await tx`
    insert into blueprints (user_id, source_filename, storage_path, spec, sample_questions)
    values (${USER}, 'Seeded sample midterm (demo)', ${`${USER}/samples/${randomUUID()}/sample.txt`},
      ${tx.json({ duration_minutes: 90, instructions_style: "Answer ALL questions.", tone_notes: "Impersonal stems, often opening with a short research scenario; options are parallel full sentences.", sections })},
      ${tx.json([{ type: "mcq", verbatim_text: "4. Which of the following is required for OLS to be unbiased? (a) Homoskedasticity of the error term. (b) Normality of the error term. (c) Zero conditional mean of the error term. (d) A sample size above 30." }])})
    returning id`;

  const slots = questions.map((q, i) => {
    const section = sections.find((s) => s.question_type === q.type);
    return {
      ordinal: i + 1,
      type: q.type,
      sectionName: section.name,
      marks: q.marks,
      styleNotes: section.style_notes,
      observedDifficulty: "medium",
      chunkId: chunkIds[q.topic],
      secondaryChunkId: null,
      topicLabel: q.topic,
      replacesSlot: null,
    };
  });
  const [exam] = await tx`
    insert into exams (blueprint_id, question_count, difficulty, status, used_chunk_ids, generation_seed, plan)
    values (${blueprint.id}, ${questions.length}, 'same', 'ready', ${tx.json([...new Set(Object.values(chunkIds))])}, 12345,
      ${tx.json({ version: 1, slots })})
    returning id`;

  for (const [i, q] of questions.entries()) {
    await tx`
      insert into questions (exam_id, ordinal, type, prompt, marks, options, correct_option, option_explanations,
        correct_explanation, expected_answer, rubric, numeric_answer, tolerance, unit, worked_solution,
        source_chunk_id, source_excerpt, topic_label, difficulty)
      values (${exam.id}, ${i + 1}, ${q.type}, ${q.prompt}, ${q.marks}, ${q.options ? tx.json(q.options) : null},
        ${q.correctOption ?? null}, ${q.optionExplanations ? tx.json(q.optionExplanations) : null},
        ${q.correctExplanation}, ${q.expectedAnswer ?? null}, ${q.rubric ? tx.json(q.rubric) : null},
        ${q.numericAnswer ?? null}, ${q.tolerance ?? null}, ${q.unit ?? null}, ${q.workedSolution},
        ${chunkIds[q.topic]}, ${q.sourceExcerpt}, ${q.topic}, 'medium')`;
  }
  for (let b = 0; b * 5 < slots.length; b++) {
    const ordinals = slots.slice(b * 5, b * 5 + 5).map((s) => s.ordinal);
    await tx`
      insert into generation_batches (exam_id, batch_index, kind, slot_ordinals, stage, outcomes)
      values (${exam.id}, ${b}, 'initial', ${tx.json(ordinals)}, 'done',
        ${tx.json(ordinals.map((slot) => ({ slot, status: "accepted", revised: false, reason: null })))})`;
  }

  console.log(`Seeded a ${questions.length}-question demo mock.`);
  console.log(`Take it:     http://localhost:3000/exam/${exam.id}`);
  console.log(`Results:     http://localhost:3000/exam/${exam.id}/results`);
});
await sql.end();
