(function (root) {
  function dayDifference(a, b) {
    // Calendar days remain 1 day apart across daylight-saving transitions.
    const day = date => Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
    return Math.round((day(a) - day(b)) / 86400000);
  }

  function context(now = new Date(), language = 'cs') {
    const locale = language === 'en' ? 'en-GB' : 'cs-CZ';
    const hour = now.getHours();
    const greeting = language === 'en'
      ? (hour < 12 ? 'Good morning, Pepa.' : hour < 18 ? 'Good afternoon, Pepa.' : 'Good evening, Pepa.')
      : (hour < 6 ? 'Dobrou noc, Pepo.' : hour < 12 ? 'Dobré ráno, Pepo.' : hour < 18 ? 'Dobré odpoledne, Pepo.' : 'Dobrý večer, Pepo.');
    return {
      now, greeting,
      date: new Intl.DateTimeFormat(locale, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(now),
      time: new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(now),
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone
    };
  }

  function describePlan(date, planStart, weekPlans, baseWorkouts, language = 'cs') {
    const days = dayDifference(date, planStart), en = language === 'en';
    if (days < 0) return en ? `The plan starts in ${-days} day(s).` : `Do začátku plánu zbývá ${-days} dní.`;
    if (days >= 70) return en ? 'The ten-week plan has ended.' : 'Desetitýdenní plán už skončil.';
    const week = Math.floor(days / 7) + 1;
    const plan = week === 1 ? baseWorkouts : weekPlans[String(week)];
    if (!plan) return en ? `Week ${week}: the plan is not ready yet.` : `${week}. týden: plán zatím není připravený.`;
    const workout = plan[days % 7];
    return en ? `Week ${week}: ${workout[1]} · ${workout[2]}.` : `${week}. týden: ${workout[1]} · ${workout[2]}.`;
  }

  function answer(text, { now = new Date(), language = 'cs', planStart, weekPlans, baseWorkouts }) {
    const query = text.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    const en = language === 'en', current = context(now, language);
    const clockQuestion = /\b(kolik (je|mame)( ted| prave| aktualne)? hodin|jaky je (ted |aktualni )?cas|what time( is it)?|current time|time zone|casove pasmo)\b/.test(query);
    const dateQuestion = /\b(jaky je( dnes| zitra| vcera)? den|co je( dnes| zitra| vcera)? za den|jake je( dnes| zitra| vcera)? datum|kolikateho( je)?|what day|what(?:'s| is)( the)? date|today(?:'s)? date)\b/.test(query);
    const planQuestion = /\b(dnes|zitra|vcera|today|tomorrow|yesterday)\b/.test(query) && /\b(plan|trenink|trenovat|bez(et|im|el)|behat|mam|mel|workout|run|running|training)\b/.test(query);
    if (!clockQuestion && !dateQuestion && !planQuestion) return null;
    const target = new Date(now);
    if (/\b(zitra|tomorrow)\b/.test(query)) target.setDate(target.getDate() + 1);
    else if (/\b(vcera|yesterday)\b/.test(query)) target.setDate(target.getDate() - 1);
    const parts = [];
    if (clockQuestion) parts.push(en ? `It is ${current.time} (${current.timeZone}).` : `Je ${current.time} (${current.timeZone}).`);
    if (dateQuestion || planQuestion) parts.push(context(target, language).date + '.');
    if (planQuestion) parts.push(describePlan(target, planStart, weekPlans, baseWorkouts, language));
    return parts.join(' ');
  }

  const api = { dayDifference, context, describePlan, answer };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.VeyvoTime = api;
})(globalThis);
