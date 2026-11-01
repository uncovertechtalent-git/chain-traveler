// English: the source of every string in the app. Other languages (app/locales/<code>.js) have exactly these keys.
//
// For translators
//  - Keep every {placeholder} exactly as written (same name, same count); you may move it within the sentence.
//  - A value that is an object is a plural: the keys are CLDR categories (zero, one, two, few, many, other) for the
//    language; {n} is the number. Give every category the language uses for whole numbers 0 to 200 ("many" for French
//    and Spanish only applies to millions and can be left out).
//  - No HTML and no "&", "<" or ">" in any value.
//  - Station names, line names (RE6) and the name "Chain Traveler" are never translated. "Deutschlandticket" stays.
//
// Words of the product
//  - chain: the sequence of regional trains that connect, one after the other, from the start to the target.
//  - change: getting off one train and onto the next (a transfer), not money.
//  - stop-over: a planned stay of some hours at a station on the way.
//  - Plan B: the screen for when a planned train does not run. "out" means the train does not run (is cancelled).
//  - "ways on": the possible ways to continue the journey from where you are.
//  - trains an hour: how many trains per hour serve a leg (frequency).
//  - late / much later: arriving after the time the plan promised. "on plan": arriving when planned or close to it.
//  - time-of-day strings such as 06:00 and the unit h (hours) and min (minutes) are formatted by the app.
export default {
  // ---- header, status, language
  'lang.label': 'Language',
  'meta.sub': 'Chain the next regional trains between any two German stations on the Deutschlandticket, with a stop-over wherever you like. Planned times, read offline from the timetable on this device.',
  'status.loading': 'Loading the timetable...',
  'status.first': 'Loading the timetable for the first time (about 5 MB)...',
  'status.loadFailed': 'The timetable could not be loaded ({message}). The first launch needs an internet connection.',
  'status.noCache': 'This browser cannot keep the timetable on the device (it needs Cache Storage over HTTPS). Try a current browser.',
  'status.readFailed': 'The stored timetable could not be read: {message}',
  'btn.retry': 'Try again',

  // ---- age of the timetable
  'age.expired': 'The timetable ended on {last}. Trains after that date are not in it; connect to the internet to update.',
  'age.soon': 'Timetable of {date}, valid until {last} ({left}). It updates itself when you are online.',
  'age.lastDay': 'last day',
  'age.moreDays': { one: '{n} more day', other: '{n} more days' },
  'age.ok': 'Timetable of {date}, valid until {last}.',
  'age.offline': 'Offline: using the timetable on this device.',
  'age.updated': 'Updated just now.',
  'age.upToDate': 'Up to date.',
  'age.checkFailed': 'Could not check for a newer timetable ({code}); the data on this device is unchanged.',

  // ---- the trip form
  'aria.trip': 'Trip',
  'field.station': 'Station',
  'field.start': 'Start',
  'field.date': 'Date',
  'field.leaveAfter': 'Leave after',
  'field.target': 'Target',
  'field.via': 'Stop-over (optional)',
  'field.stay': 'Minimum stay (min)',
  'field.change': 'Minimum change (min)',
  'btn.plan': 'Plan chain',
  'btn.swap': 'Swap start and target',
  'btn.clearvia': 'No stop-over',

  // ---- tabs
  'tab.chain': 'Chain',
  'tab.reach': 'Reach map',
  'tab.deps': 'Departures',
  'tab.live': 'Plan B',

  // ---- chain
  'chain.intro': 'Pick a start and a target station to chain the next regional trains between them.',
  'chain.pickBoth': 'Pick a start and a target station from the suggestions.',
  'chain.noTrainToday': 'No usable train from {from} on {day} after {time}. The first chain leaves on {first}.',
  'chain.timeRange': '{dep} to {arr}',
  'leg.fromTo': '{from} to {to}',
  'chain.onTheWay': 'on the way',
  'chain.changes': { one: 'change', other: 'changes' },
  'chain.changesStop': { one: 'change plus the stop-over', other: 'changes plus the stop-over' },
  'chain.stay': 'Stop-over in {station}: arrive {arr}, leave {dep} ({dur})',
  'chain.wait': '{min} at {station}',
  'chain.waitTight': '{min} at {station} (tight change)',
  'chain.walk': 'Walk {from} to {to}',
  'leg.towards': 'towards {term}, {dur}',
  'btn.out': 'This train is out?',
  'chain.nextTrains': 'Next trains at each stop',
  'chain.arrive': '(arrive {time})',
  'dep.towards': 'towards {term}',
  'dep.nextStop': 'next stop {stop}',

  // ---- reach map
  'reach.within': 'Show stations reached within {hours} h of leaving',
  'reach.sooner': 'sooner',
  'reach.later': 'later',
  'reach.note': 'Every dot is a station reachable by regional train. Colour shows how soon you can be there from the start station. Click a dot to chain a trip there.',

  // ---- departures
  'field.after': 'After',
  'deps.pick': 'Pick a station.',
  'deps.none': 'No departures after that time.',
  'deps.th.departs': 'Departs',
  'deps.th.line': 'Line',
  'deps.th.towards': 'Towards',
  'deps.th.next': 'Next stop',

  // ---- Plan B
  'live.intro': 'Your train is out? Say where you are and where you are going. You get the ways on from here, each set against your plan, and how many trains an hour stand behind every leg.',
  'field.iAmAt': 'I am at',
  'field.timeNow': 'Time now',
  'field.goingTo': 'Going to',
  'field.plannedArr': 'Planned arrival (optional)',
  'btn.locate': 'Use my location',
  'live.say': 'Say where you are and where you are going.',
  'live.depsTitle': 'Trains from {station} after {time}',
  'live.noMoreToday': 'No train leaves {station} on this date after {time} in the timetable. These are on the next day (+1).',
  'live.tick': 'Tick the ones that are out.',
  'live.unlisted': { one: '{n} more marked out earlier, not in this list.', other: '{n} more marked out earlier, not in this list.' },
  'live.leadPlan': 'Your plan arrived at {plan}. The best way on now arrives at {best}{later}.',
  'live.later': ', {dur} later',
  'live.leadBest': 'No planned arrival given, so the best way on (arriving {best}) is the yardstick.',
  'graph.label': 'Ways from {from} to {to}',

  // ---- Plan B: how a way compares
  'chip.best': 'best way',
  'chip.best.good': 'close to the best, +{dur}',
  'chip.best.mid': 'later, +{dur}',
  'chip.best.bad': 'much later, +{dur}',
  'chip.plan.early': 'on plan, {dur} early',
  'chip.plan.exact': 'on plan',
  'chip.plan.good': 'on plan, +{dur}',
  'chip.plan.mid': 'late, +{dur}',
  'chip.plan.bad': 'much later, +{dur}',
  'tag.earliest': 'Earliest arrival',
  'tag.fewest': 'Fewest changes',
  'tag.robust': 'Most trains an hour',
  'opt.arrive': 'arrive',
  'opt.leave': 'leave {time}',
  'opt.changes': { one: '{n} change', other: '{n} changes' },
  'opt.tightest': 'tightest change {min}',
  'opt.thinnest': { one: 'thinnest leg {n} train an hour', other: 'thinnest leg {n} trains an hour' },

  // ---- Plan B: legend. green, amber and red are the colours of the chips and lines
  'legend.green': 'green',
  'legend.amber': 'amber',
  'legend.red': 'red',
  'legend.basePlan': 'your plan',
  'legend.baseBest': 'the best way',
  'legend.good': 'up to {n} min after {base}',
  'legend.mid': 'up to {n} min',
  'legend.bad': 'beyond that.',
  'legend.thick': 'Line thickness: trains an hour on that leg, from one (thin) to four or more (thick).',
  'legend.dotted': 'The dotted line: the plan you had.',
  'legend.context': 'Grey: the other stations you can reach from here.',

  // ---- Plan B: where you are
  'loc.looking': 'Looking for your position...',
  'loc.unsupported': 'This browser cannot tell where you are. Pick the station by name.',
  'loc.denied': 'Location is not allowed for this page. Allow it for this site in the browser settings, or pick the station by name.',
  'loc.unavailable': 'The device could not work out where you are. Pick the station by name.',
  'loc.timeout': 'Finding your position took too long. Try again, or pick the station by name.',
  'loc.none': 'No station with regional trains within 40 km of you. Pick the station by name.',
  'loc.near': 'You are near {station} ({dist}). Date and time set to now.',
  'loc.rough': 'The position is only accurate to about {km} km, so check the station.',
  'loc.private': 'Your position stays on this device.',
  'loc.notHere': 'Not here?',

  // ---- Navigate: follow the chain by the clock and, if you allow it, by position; recalculate when the plan breaks
  'nav.title': 'Navigation',
  'nav.to': 'to {station}',
  'nav.stop': 'Stop',
  'nav.follow': 'Follow this chain',
  'nav.followWay': 'Follow this way',
  'nav.train': '{line} from {from} to {to}',
  'nav.before': 'Next: {leg}, leaves {dep} (in {inMin}).',
  'nav.waiting': 'At {station}: {leg}, leaves {dep} (in {inMin}).',
  'nav.riding': 'On the {line}: get off at {to} at {arr} (in {inMin}).',
  'nav.walking': 'Walk to {to} ({inMin}).',
  'nav.done': 'You have arrived at {station}.',
  'nav.then': 'Then: {leg}, leaves {dep}.',
  'nav.arriving': 'Arriving {arr}; your plan was {plan}.',
  'nav.later': '{delta} later than planned.',
  'nav.onPlan': 'No later than planned.',
  'nav.recalcs': { one: 'Recalculated once.', other: 'Recalculated {n} times.' },
  'nav.recalc.missed': 'Recalculated: you did not get the {line} of {dep}. New arrival {arr}.',
  'nav.recalc.elsewhere': 'Recalculated: you are at {station}, not at {expected}. New arrival {arr}.',
  'nav.noWay': 'No way on from here after this time.',
  'nav.outside': 'This chain is on {day}, which is not today. Use the test clock below to walk through it.',
  'nav.onBoard': "I'm on board",
  'nav.missed': 'I missed it',
  'nav.track': 'Track my position',
  'nav.untrack': 'Stop tracking',
  'nav.ways': 'Other ways (Plan B)',
  'nav.privacy': 'Your position, if you allow it, stays on this device.',
  'nav.near': 'You are near {station} ({dist}).',
  'nav.nowhere': 'No station with trains within 5 km of you.',
  'nav.here': 'You are here',
  'nav.graph': 'Your route and the ways around it',
  'nav.legendRoute': 'Thick line: your route. Colours: the other ways if the next train is out, by how much later they arrive.',
  'nav.legendOld': 'Dotted: the plan before the last recalculation.',
  'nav.test': 'Test the clock',
  'nav.clock': 'Pretend it is',

  // ---- search errors
  'err.sameStation': 'Start and target are the same station.',
  'err.viaUnreachable': 'The stop-over cannot be reached after the start time.',
  'err.noOnward': 'No onward connection after the stay; try a shorter stay or an earlier start.',
  'err.noConnection': 'No connection that day after the start time.',
  'err.alreadyThere': 'You are already at the target.',
  'err.noWay': 'No way on to the target from here after that time.',

  // ---- footer
  'foot': 'Timetable: {publisher}, {license}. {stations} stations, {connections} connections, {first} to {last}. Planned times only, no delays or engineering works. Check the trip in DB Navigator before you travel.',

  // ---- units. {n} is a number
  'unit.h': 'h',
  'unit.min': 'min',
  'unit.m': '{n} m',
  'unit.km': '{n} km',
  'unit.perHour': '{n}/h',

  // ---- the page for an address that does not exist
  'nf.title': 'Not found',
  'nf.body': 'There is no page at this address. {app} plans chains of regional trains on the Deutschlandticket, offline.',
};
