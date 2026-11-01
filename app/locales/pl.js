// Polski. Te same klucze co w en.js.
export default {
  // ---- header, status, language
  'lang.label': 'Język',
  'meta.sub': 'Ułóż łańcuch z kolejnych pociągów regionalnych między dowolnymi stacjami w Niemczech na Deutschlandticket, z postojem tam, gdzie zechcesz. Godziny planowe, odczytywane offline z rozkładu na tym urządzeniu.',
  'status.loading': 'Wczytywanie rozkładu...',
  'status.first': 'Pierwsze wczytywanie rozkładu (ok. 5 MB)...',
  'status.loadFailed': 'Nie udało się wczytać rozkładu ({message}). Pierwsze uruchomienie wymaga połączenia z internetem.',
  'status.noCache': 'Ta przeglądarka nie może zapisać rozkładu na urządzeniu (potrzebuje Cache Storage przez HTTPS). Użyj aktualnej przeglądarki.',
  'status.readFailed': 'Nie udało się odczytać zapisanego rozkładu: {message}',
  'btn.retry': 'Spróbuj ponownie',

  // ---- age of the timetable
  'age.expired': 'Rozkład obowiązywał do {last}. Pociągów po tej dacie w nim nie ma; połącz się z internetem, aby go zaktualizować.',
  'age.soon': 'Rozkład z {date}, ważny do {last} ({left}). Aktualizuje się sam, gdy jesteś online.',
  'age.lastDay': 'ostatni dzień',
  'age.moreDays': { one: 'jeszcze {n} dzień', few: 'jeszcze {n} dni', many: 'jeszcze {n} dni', other: 'jeszcze {n} dnia' },
  'age.ok': 'Rozkład z {date}, ważny do {last}.',
  'age.offline': 'Offline: używany jest rozkład z tego urządzenia.',
  'age.updated': 'Właśnie zaktualizowano.',
  'age.upToDate': 'Rozkład jest aktualny.',
  'age.checkFailed': 'Nie udało się sprawdzić, czy jest nowszy rozkład ({code}); dane na urządzeniu bez zmian.',

  // ---- the trip form
  'aria.trip': 'Podróż',
  'field.station': 'Stacja',
  'field.start': 'Skąd',
  'field.date': 'Data',
  'field.leaveAfter': 'Wyjazd po',
  'field.target': 'Dokąd',
  'field.via': 'Postój (opcjonalnie)',
  'field.stay': 'Min. czas postoju (min)',
  'field.change': 'Min. czas przesiadki (min)',
  'btn.plan': 'Zaplanuj łańcuch',
  'btn.swap': 'Zamień miejscami',
  'btn.clearvia': 'Bez postoju',

  // ---- tabs
  'tab.chain': 'Łańcuch',
  'tab.reach': 'Mapa zasięgu',
  'tab.deps': 'Odjazdy',
  'tab.live': 'Plan B',

  // ---- chain
  'chain.intro': 'Wybierz stację początkową i docelową, aby ułożyć łańcuch z kolejnych pociągów regionalnych.',
  'chain.pickBoth': 'Wybierz stację początkową i docelową z podpowiedzi.',
  'chain.noTrainToday': 'Brak odpowiedniego pociągu ze stacji {from} w dniu {day} po {time}. Pierwszy łańcuch odjeżdża {first}.',
  'chain.timeRange': '{dep} – {arr}',
  'leg.fromTo': '{from} – {to}',
  'chain.onTheWay': 'w drodze',
  'chain.changes': { one: 'przesiadka', few: 'przesiadki', many: 'przesiadek', other: 'przesiadki' },
  'chain.changesStop': { one: 'przesiadka plus postój', few: 'przesiadki plus postój', many: 'przesiadek plus postój', other: 'przesiadki plus postój' },
  'chain.stay': 'Postój na stacji {station}: przyjazd {arr}, odjazd {dep} ({dur})',
  'chain.wait': '{min} na stacji {station}',
  'chain.waitTight': '{min} na stacji {station} (krótka przesiadka)',
  'chain.walk': 'Pieszo: {from} – {to}',
  'leg.towards': 'kierunek {term}, {dur}',
  'btn.out': 'Pociąg odwołany?',
  'chain.nextTrains': 'Następne pociągi na każdej stacji',
  'chain.arrive': '(przyjazd {time})',
  'dep.towards': 'kierunek {term}',
  'dep.nextStop': 'następny przystanek: {stop}',

  // ---- reach map
  'reach.within': 'Pokaż stacje osiągalne w ciągu {hours} godz. od wyjazdu',
  'reach.sooner': 'wcześniej',
  'reach.later': 'później',
  'reach.note': 'Każda kropka to stacja osiągalna pociągiem regionalnym. Kolor pokazuje, jak szybko możesz tam dotrzeć ze stacji początkowej. Kliknij kropkę, aby ułożyć tam łańcuch.',

  // ---- departures
  'field.after': 'Po godz.',
  'deps.pick': 'Wybierz stację.',
  'deps.none': 'Brak odjazdów po tej godzinie.',
  'deps.th.departs': 'Odjazd',
  'deps.th.line': 'Linia',
  'deps.th.towards': 'Kierunek',
  'deps.th.next': 'Następny przystanek',

  // ---- Plan B
  'live.intro': 'Pociąg odwołany? Podaj, gdzie jesteś i dokąd jedziesz. Zobaczysz opcje dalszej jazdy stąd, każdą porównaną z planem, oraz ile pociągów na godzinę kursuje na każdym odcinku.',
  'field.iAmAt': 'Jestem na stacji',
  'field.timeNow': 'Obecna godzina',
  'field.goingTo': 'Jadę do',
  'field.plannedArr': 'Planowany przyjazd (opcjonalnie)',
  'btn.locate': 'Użyj mojej lokalizacji',
  'live.say': 'Podaj, gdzie jesteś i dokąd jedziesz.',
  'live.depsTitle': 'Pociągi ze stacji {station} po {time}',
  'live.noMoreToday': 'W rozkładzie nie ma już pociągu ze stacji {station} tego dnia po {time}. Poniżej pociągi z następnego dnia (+1).',
  'live.tick': 'Zaznacz odwołane pociągi.',
  'live.unlisted': {
    one: 'Jeszcze {n} pociąg oznaczono wcześniej jako odwołany; nie ma go na tej liście.',
    few: 'Jeszcze {n} pociągi oznaczono wcześniej jako odwołane; nie ma ich na tej liście.',
    many: 'Jeszcze {n} pociągów oznaczono wcześniej jako odwołane; nie ma ich na tej liście.',
    other: 'Jeszcze {n} pociągu oznaczono wcześniej jako odwołane; nie ma ich na tej liście.',
  },
  'live.leadPlan': 'Plan zakładał przyjazd o {plan}. Najlepsza opcja dalszej jazdy daje przyjazd o {best}{later}.',
  'live.later': ', {dur} później',
  'live.leadBest': 'Nie podano planowanego przyjazdu, więc punktem odniesienia jest najlepsza opcja dalszej jazdy (przyjazd {best}).',
  'graph.label': 'Opcje dalszej jazdy: {from} – {to}',

  // ---- Plan B: how a way compares
  'chip.best': 'najlepsza opcja',
  'chip.best.good': 'blisko najlepszej, +{dur}',
  'chip.best.mid': 'później, +{dur}',
  'chip.best.bad': 'dużo później, +{dur}',
  'chip.plan.early': 'zgodnie z planem, {dur} wcześniej',
  'chip.plan.exact': 'zgodnie z planem',
  'chip.plan.good': 'zgodnie z planem, +{dur}',
  'chip.plan.mid': 'później, +{dur}',
  'chip.plan.bad': 'dużo później, +{dur}',
  'tag.earliest': 'Najwcześniejszy przyjazd',
  'tag.fewest': 'Najmniej przesiadek',
  'tag.robust': 'Najwięcej pociągów na godzinę',
  'opt.arrive': 'przyjazd',
  'opt.leave': 'odjazd {time}',
  'opt.changes': { one: '{n} przesiadka', few: '{n} przesiadki', many: '{n} przesiadek', other: '{n} przesiadki' },
  'opt.tightest': 'najkrótsza przesiadka {min}',
  'opt.thinnest': {
    one: 'najrzadszy odcinek: {n} pociąg na godzinę',
    few: 'najrzadszy odcinek: {n} pociągi na godzinę',
    many: 'najrzadszy odcinek: {n} pociągów na godzinę',
    other: 'najrzadszy odcinek: {n} pociągu na godzinę',
  },

  // ---- Plan B: legend. green, amber and red are the colours of the chips and lines
  'legend.green': 'zielony',
  'legend.amber': 'pomarańczowy',
  'legend.red': 'czerwony',
  'legend.basePlan': 'twój plan',
  'legend.baseBest': 'najlepsza opcja',
  'legend.good': 'do {n} min później niż {base}',
  'legend.mid': 'do {n} min',
  'legend.bad': 'jeszcze później.',
  'legend.thick': 'Grubość linii: liczba pociągów na godzinę na odcinku, od jednego (cienka) do czterech lub więcej (gruba).',
  'legend.dotted': 'Linia kropkowana: dotychczasowy plan.',

  // ---- Plan B: where you are
  'loc.looking': 'Ustalanie pozycji...',
  'loc.unsupported': 'Ta przeglądarka nie potrafi ustalić, gdzie jesteś. Wybierz stację po nazwie.',
  'loc.denied': 'Lokalizacja jest zablokowana dla tej strony. Zezwól na nią dla tej witryny w ustawieniach przeglądarki albo wybierz stację po nazwie.',
  'loc.unavailable': 'Urządzenie nie mogło ustalić, gdzie jesteś. Wybierz stację po nazwie.',
  'loc.timeout': 'Ustalanie pozycji trwało zbyt długo. Spróbuj ponownie albo wybierz stację po nazwie.',
  'loc.none': 'W promieniu 40 km od ciebie nie ma stacji z pociągami regionalnymi. Wybierz stację po nazwie.',
  'loc.near': 'Jesteś blisko stacji {station} ({dist}). Ustawiono bieżącą datę i godzinę.',
  'loc.rough': 'Pozycja jest dokładna tylko do ok. {km} km, więc sprawdź stację.',
  'loc.private': 'Twoja pozycja zostaje na tym urządzeniu.',
  'loc.notHere': 'Nie tutaj?',

  // ---- search errors
  'err.sameStation': 'Stacja początkowa i docelowa są takie same.',
  'err.viaUnreachable': 'Nie da się dojechać na postój po wybranej godzinie wyjazdu.',
  'err.noOnward': 'Brak dalszego połączenia po postoju; skróć postój albo wyjedź wcześniej.',
  'err.noConnection': 'Brak połączenia tego dnia po wybranej godzinie.',
  'err.alreadyThere': 'Jesteś już na stacji docelowej.',
  'err.noWay': 'Stąd po tej godzinie nie da się już dojechać do celu.',

  // ---- footer
  'foot': 'Rozkład: {publisher}, {license}. Stacji: {stations}, połączeń: {connections}, {first} – {last}. Tylko godziny planowe, bez opóźnień i prac torowych. Przed podróżą sprawdź trasę w DB Navigator.',

  // ---- units. {n} is a number
  'unit.h': 'godz.',
  'unit.min': 'min',
  'unit.m': '{n} m',
  'unit.km': '{n} km',
  'unit.perHour': '{n}/godz.',

  // ---- the page for an address that does not exist
  'nf.title': 'Nie znaleziono',
  'nf.body': 'Pod tym adresem nie ma strony. {app} układa łańcuchy pociągów regionalnych na Deutschlandticket, offline.',
};
