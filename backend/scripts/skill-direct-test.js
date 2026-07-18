/** Direct skill tests (no LLM) — weather + calendar */
const { NestFactory } = require('@nestjs/core');
const { AppModule } = require('../dist/app.module');
const { WeatherSkill } = require('../dist/skills/impl/weather.skill');
const { CalendarSkill } = require('../dist/skills/impl/calendar.skill');

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error'] });
  const weather = app.get(WeatherSkill);
  const calendar = app.get(CalendarSkill);

  console.log('=== WEATHER ===');
  const w = await weather.execute({ location: 'Tunis', days: 1 });
  console.log('success:', w.success);
  console.log('output:', w.output?.slice(0, 200));

  console.log('\n=== CALENDAR CREATE ===');
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(10, 0, 0, 0);
  const c = await calendar.execute({
    action: 'create',
    title: 'Subagent test standup',
    start: tomorrow.toISOString(),
  });
  console.log('success:', c.success);
  console.log('output:', c.output);

  console.log('\n=== CALENDAR LIST ===');
  const l = await calendar.execute({ action: 'list' });
  console.log('success:', l.success);
  console.log('output:', l.output);

  await app.close();
  const pass = w.success && c.success && l.success && l.output.includes('Subagent test standup');
  console.log('\nRESULT:', pass ? 'PASS' : 'FAIL');
  process.exit(pass ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
