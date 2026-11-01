# Graphs, by parable

Chain Traveler is GPS for the Deutschlandticket. A car GPS knows where you are, where you want to go, and which roads
exist; when you miss a turn it says "recalculating". Chain Traveler does the same on the regional trains the ticket allows.
The difference between the two is the whole lesson: a road is always there, and a train is there for one minute.

This page teaches how a graph works through four short stories, each tied to a screen of the app. Numbers are from the
real timetable (7,645 stations, 1,471,826 connections, 107,488 trips, a window of 31 days).

## What a graph is

A graph is a set of places and a set of ways between them. Nothing more. The places are called nodes and the ways are
called edges. A road map is a graph: junctions are nodes, road sections are edges, and an edge may carry a number
(a length, a speed limit, a toll). Every GPS in the world answers one question on such a graph: *what is the cheapest
way from here to there*, where "cheapest" is whatever number you put on the edges.

## Story 1: the map and the clock

A man arrives at a town with a road map and asks the clerk at the kiosk for the quickest way to the next town. The clerk
adds up the road lengths and the speed limits, finds the cheapest chain of roads, and is done. The roads were open
yesterday, they are open now, and they will be open tomorrow. One graph, drawn once.

The same man arrives at a station with a timetable. Now the clerk is in trouble, because a "way" from Wolfsburg to
Magdeburg exists only at 06:23, 07:05, 08:22 and a few other minutes. At 06:24 that edge is gone. Whether you can use the
next edge depends on when you arrived, which depends on every edge before it.

So a timetable is a graph whose edges have a **departure time and an arrival time**. The cheapest path is no longer the
shortest one; it is the one that arrives **earliest**. Chain Traveler stores 1,471,826 such timed edges ("connections")
and 7,645 nodes ("stations"), and asks one question: if I stand here at this minute, what is the earliest I can be
anywhere else?

A change from one train to the next is a rule on top of the edges: you may board a train only if you arrived at least a
few minutes before it leaves (the minimum change time), or if you are staying on it. A walk between two stations that are
300 metres apart is an edge too, one that is always open.

## Story 2: the clerk who reads the day once

The clever clerk does not try every route. She takes all 1.5 million connections and sorts them by departure time, as
one long list. Then she walks down the list once, keeping a notebook: "earliest I can be at each station". For each
connection she asks one thing: *could I already have been at its departure station, early enough to catch this?* If yes,
she writes its arrival time next to the arrival station, if that beats what is already there. When she reaches the
bottom of the list the notebook is complete: the earliest arrival at **every** station, not just the one you asked about.

This is called the connection scan. It is fast because time only moves forward: nothing later in the list can help
something earlier. It takes about 80 milliseconds on a laptop and runs on the phone, with no server and no network, which
is why the app works in a tunnel.

## Story 3: recalculating

The man is at the platform. The 06:23 does not come. In a car you would take the next exit and the GPS would draw a new
line. Here the clerk does the same thing in the only way a graph allows: **she crosses out the edge that failed and asks
again.** The 06:23 is marked as out (only that run, not the 06:23 of tomorrow), and the scan runs from where he stands, at
this minute.

That is the "This train is out?" button and the Plan B screen. It finds not one new route but up to four, each one a
different first train, and sets them against the plan he had:

- **Colour** is how much later than the plan each way arrives: green up to 15 minutes, amber up to an hour, red beyond.
  It is a number on the destination, shown as a colour.
- **Thickness** is how many trains an hour serve each leg. A thick line is a leg you could miss and still be fine. A thin
  line is a leg with no second chance. It says how robust a path is, which the arrival time alone does not.
- **Dotted** is the plan he had, drawn over everything so he can see what he lost.

## Story 4: the tree that grows from where you stand

The clerk's notebook has a second use. For every station she wrote down when you could be there, and she also wrote down
*which connection got you there first*. Draw a line for each of those and you get a tree: your station is the trunk, and
every station you can reach hangs from the station before it. In graph language this is the **shortest-path tree**.

That is the grey network behind the ways in Plan B. It is not advice. It is the answer to "where else does this go?",
the same way a GPS shows the other roads at a junction. When Magdeburg shows up as a thick knot of grey lines, it is
because many earliest arrivals in the region run through Magdeburg.

## What a graph does not know

The clerk has the timetable, not the day. If a train is twenty minutes late the paper does not say so, and if a train is
cancelled she only knows because you told her. Car GPS has the same problem and solves it with live traffic. For trains
the equivalent is a live feed of delays (GTFS-Realtime), which exists for part of Germany and is a separate service with a
separate licence. Until it is added, every "late" in the app means "later than planned, if every train runs as planned".

Two more limits. The timetable says what the operators **published**: at the time of writing the feed has no
Saturday trains and almost no Sunday trains at Wolfsburg Hbf, and the app shows what the file says. And the Deutschlandticket
covers regional trains only, so the long-distance trains are not edges in this graph at all. A GPS that never offers the
motorway is still a GPS; it is a GPS for the roads you may use.

## The GPS table

| GPS | Chain Traveler |
|---|---|
| Where you are | "Use my location": the nearest station that has trains, worked out on the device |
| The roads | The trains the Deutschlandticket allows, as timed edges |
| The route | The chain: the earliest arrival, with changes and stop-overs |
| "Recalculating" | Plan B: cross out the failed train, scan again from here, now |
| The other roads at a junction | The grey network: the shortest-path tree from where you stand |
| Live traffic | Delays (GTFS-Realtime): partial, and not yet in the routing |

## Where to read the code

- `app/engine.js`: the connection scan (`earliestArrival`), the journey rebuilt from its notebook (`legsTo`), the tree
  (`reachEdges`), trains an hour (`callsPerWindow`).
- `app/planb.js`: the ways on (`ways`), colour and thickness (`plan`), the network behind them (`contextOf`).
- `app/graph.js`: the picture.
