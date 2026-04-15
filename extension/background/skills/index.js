// Skill data — domain knowledge injected into LLM prompts for complex workflows

export const SKILLS = [
  {
    id: 'flight-booking',
    name: 'Flight Booking',
    description: 'Use when the user wants to book, search for, or find flights. Covers any request about airline tickets, flying somewhere, round trips, one-way flights, nonstop flights, cheap flights, flight comparisons, or travel by air. Also applies when the user is already on Google Flights, an airline website (American, Delta, United, Southwest, JetBlue, Spirit, Frontier), or a travel booking portal (Amex Travel, Capital One Travel, Kayak, Expedia).',
    stop_gates: ['payment', 'credit card', 'purchase', 'complete booking', 'pay now', 'place order'],
    clarification_points: [
      { when: 'user says \'next weekend\' or \'this weekend\' without specifying days', ask: 'Depart Friday evening or Saturday morning? And return Sunday or Monday?' },
      { when: 'cheapest flight has bad timing (red-eye, very early, arrives past midnight)', ask: 'The cheapest nonstop is $X but arrives at [bad time]. Next option is $Y arriving at [better time]. Which do you prefer?' },
      { when: 'multiple airports available for origin or destination city', ask: 'I see flights from JFK, LGA, and EWR. Do you have a preferred departure airport?' },
      { when: 'user may have travel credit cards or portal preferences', ask: 'Want me to check Amex Travel or Capital One portal for better prices or points, or book direct through Google Flights?' },
      { when: 'significant price difference between nonstop and 1-stop', ask: 'Nonstop flights start at $X. Flights with 1 stop start at $Y (saves $Z). Want nonstop only?' },
      { when: 'budget carrier is cheapest but has no included bags', ask: 'The cheapest option is [airline] at $X but charges extra for carry-on and checked bags. [Full-service airline] is $Y more but includes a carry-on. Which do you prefer?' },
    ],
    body: `
# Flight Booking Guide

## Overview
Guide the user from search to the airline booking/passenger page. Stop before payment.
The core value is finding the RIGHT flight the user is happy with — not just the cheapest.

## Step 1: Google Flights Search Setup

Start at google.com/travel/flights.

**Default state on landing:**
- Round trip (pre-selected)
- 1 passenger
- Economy
- Origin may be pre-filled from user's location

**Fill the search form:**
1. Origin field (\`Where from?\`): usually pre-filled with user's city. Keep it unless user specifies otherwise. It's a combobox — type to search, select from dropdown.
2. Destination field (\`Where to?\`): click → type city name → dropdown appears with hierarchy:
   - City name (e.g., "Miami, Florida") — covers ALL airports, expandable
   - Individual airports listed below (e.g., MIA, FLL)
   - **Select the city-level option** unless user names a specific airport
3. Departure date: click the "Departure" field → calendar picker opens
4. Return date: after selecting departure, picker auto-switches to "Return" tab

**Calendar picker details:**
- Two months shown side-by-side
- Prices displayed on each selectable date
- Past dates are grayed out (no prices)
- Click a specific day to select (do NOT try to type dates)
- Bottom bar shows "Showing prices in USD for N day trips"
- After selecting both dates, click the **"Done"** button (bottom right)
- \`<\` \`>\` arrows next to selected date let you shift by one day

**Do NOT click "Explore"** — that's for flexible/undecided destinations. Click "Search" or the search icon after filling all fields.

## Step 2: Apply Filters

After search results load:

**Filter bar** (horizontal, below search form): All filters, Stops, Airlines, Bags, Price, Times, Emissions, Connecting airports, Duration

**For "nonstop" requests:**
1. Click **"Stops"** filter button
2. Dropdown shows radio buttons: Any number of stops, **Nonstop only**, 1 stop or fewer, 2 stops or fewer
3. Select **"Nonstop only"**
4. Filter auto-applies — results update live, no "Done" button needed
5. Filter shows as blue chip "Nonstop x" in the filter bar
6. "All filters (1)" counter updates

**After filtering:**
- Two tabs appear: **"Best"** (default, yellow highlight) and **"Cheapest from $X"**
- "Best" is sorted by price + convenience blend
- Click "Cheapest" tab if user explicitly wants lowest price

## Step 3: Review and Select Departing Flight

**Results page structure:**
- "Top departing flights" section (3-5 results, Google's recommendations)
- "Other departing flights" section below (scroll down to see)

**IMPORTANT:** The best flight for the user is often NOT in "Top departing flights." Always scan "Other departing flights" too, especially for preferred departure times.

**Each result row shows:**
- Airline logo + name
- Departure time – Arrival time (with +1 if next day)
- Duration (e.g., "3 hr 14 min")
- Route (e.g., "LGA–MIA")
- Stops ("Nonstop" or "1 stop, 59 min CLT")
- CO2 emissions
- Baggage icons (carry-on, checked bag — 0 means not included, costs extra)
- Price (round trip total)
- Expand arrow (v)

**Click a flight row** to expand details:
- Departure/arrival airports with full names
- Travel time
- Amenities: legroom, Wi-Fi, power outlets, streaming
- Aircraft type and flight number
- Delay warnings (e.g., "Often delayed by 30+ min")
- **"Select flight"** button

**Decision support before selecting:**
- If user said "cheapest": identify the cheapest nonstop and present it with any timing tradeoffs
- If timing matters: find flights matching user's preferred time window
- Note baggage differences — budget carriers (Spirit, Frontier) charge for ALL bags
- If there's a meaningful tradeoff, use ask_user to present 2-3 options

Click **"Select flight"** on the chosen departing flight.

## Step 4: Select Return Flight

After selecting departing flight, page changes to return flight selection:
- Header shows "LGA–MIA → Choose return to New York" (or similar)
- Same two-section layout: "Top returning flights" + "Other returning flights"
- Prices shown are **round trip totals** (departure + this return)

**Same approach:** scan both sections, find the time that matches user's preference, expand to check details, click "Select flight."

## Step 5: Booking Summary Page (Google Flights)

After both flights selected, a summary page shows:
- "New York ↔ Miami" header with total price
- Both selected flights listed with details
- **"Track prices"** toggle
- **"Booking options"** section:
  - "Book with [Airline]" — shows fare tiers side by side
  - Example tiers: Main Cabin ($722), Main Plus ($836), Main Select ($881)
  - Each tier lists: seat selection, legroom, boarding priority, change policy, bags
  - Each has a **"Continue"** button
- **Price insight** at bottom: "is typical/low/high" with price history graph

**Default to the cheapest fare tier** (usually "Main Cabin" or "Economy") unless user specifies otherwise.

**CRITICAL DECISION POINT — Credit card travel portals:**
Before clicking "Continue," this is where to ask_user about checking travel portals (Amex, Capital One, etc.) if relevant. Portal prices may differ, and booking through portals earns extra points.

## Step 5b: Amex Travel Portal Comparison (if user opts in)

If the user wants to check Amex Travel, open a new tab and navigate to americanexpress.com/en-us/travel/.

**Landing page:**
- Default tab is **Hotels** — you MUST click the **"Flights"** tab first
- Left sidebar shows "My Travel Benefits" with Membership Rewards balance (e.g., 217,375 points)
- Benefits sections: 2X on Prepaid Hotels, Insider Fares, Pay with Points

**Flight search form (after clicking Flights tab):**
- Trip type: Round Trip (dropdown)
- Number of Travelers: 1 (dropdown)
- Flight Class: Economy (dropdown)
- Where from / Where to: type city, uses format "NYC, New York, NY, United States of America (NYC-All)"
- Calendar picker: two months side-by-side, click dates, click "Done"
- **No prices shown on calendar dates** (unlike Google Flights)

**IMPORTANT: Domain change after search.**
After clicking search, the browser redirects from americanexpress.com to **amextravel.com** — a different domain. Follow this redirect.

**Amex Travel results page (amextravel.com):**
- Search summary bar at top with "Update" button
- "Select Your Departure Flight" heading
- Left sidebar: **Filter By**
  - Stops: checkboxes (not radio buttons!) — "Non-Stop $X" and "1 Stop $X"
  - Departure time: slider (e.g., Fri 6:00am to Fri 8:38pm)
  - Landing time: slider
- Sort by links: Lowest, Duration, Departure Time, **Membership Rewards Points**, Recommended (default)
- Each result shows: times, route, duration, stops, amenities, price **OR** points alternative, airline name
- "1 left at this price" urgency indicators may appear
- "Show flight details & baggage fees" expandable

**Key differences from Google Flights:**
- Prices may be HIGHER or LOWER for the same flight — always compare
- Every flight shows a points cost alternative (e.g., "$547 or 54,680 Membership Rewards Points")
- Fewer airlines available — budget carriers (Spirit, JetBlue, Southwest) often missing
- No "Best"/"Cheapest" tabs — use the "Lowest" sort link instead
- Check "Non-Stop" checkbox in filters (not radio button like Google Flights)

**Selecting flights on Amex:**
1. Click "Select" on desired departure → shows "Selected Departure" at top with "Change" link
2. Page shows "Select Your Return Flight" below
3. Return prices show as **incremental** ("+$0" or "+$50") not total round trip
4. Click "Select" on desired return → goes to "Review Your Trip" page

**Review Your Trip page:**
- Shows both flights with full details (airline, flight number, airports, times)
- **"This trip starts and ends at different airports"** warning if departure/return use different airports — flag this to user
- Right sidebar: "My Trip Summary" with total cost AND points equivalent
  - Example: Total Trip Cost $677.80 OR 67,780 Membership Rewards Points
  - Breakdown: base fare + taxes & airline fees
- **"Upgrade Your Flights"** section: fare tiers with incremental pricing
  - MAIN CABIN (+$0, selected by default)
  - MAIN PLUS (+$114 or +11,400 pts)
  - MAIN CABIN FLEXIBLE (+$125 or +12,501 pts)
  - MAIN SELECT (+$170 or +17,000 pts)
  - FIRST (+$983 or +98,300 pts)
- Free 24 Hour Cancellation policy shown

**Decision support — compare with Google Flights:**
Present to user: "Google Flights: $722 direct. Amex Travel: $677.80 (saves $44) or 67,780 points. Amex also offers free 24-hour cancellation. Which do you prefer?"

If user has enough points (visible from their balance), note: "You have 217,375 points — enough to cover this flight and still have 149,595 remaining."

**STOP at the Review page** — do not proceed to payment. Inform user of the comparison and let them decide.

## Step 5c: Capital One Travel Portal Comparison (if user opts in)

If the user wants to check Capital One Travel, open a new tab and navigate to travel.capitalone.com.

**Landing page:**
- Default tab is **Stays** — you MUST click the **"Flights"** tab first
- Tabs: Flights, Stays (New), Packages (New), Rental Cars, Activities (New), Premium Stays
- Top right shows rewards balance in BOTH forms: "You have **155,886 miles** or **$1,558.86** for travel" — the cash equivalent is useful for comparison
- May show "Continue your search" section with previous searches
- URL stays on travel.capitalone.com (no domain change unlike Amex)

**Flight search form (after clicking Flights tab):**
- Trip type: **Radio buttons** — Round-trip, One-way, Multi-city
- 1 Traveler (dropdown)
- Any class (dropdown)
- **"Non-stop only" toggle switch** — right in the search form! No need to filter after results. Toggle this ON for nonstop requests.
- Where from? / Where to? — text fields with swap icon
- Departure / Return date fields

**Calendar picker:**
- Modal dialog: "Select the arrival and departure dates for your flight"
- Two months side-by-side
- **Color-coded price ranges on each date:**
  - Green ($): $125 - $175
  - Yellow ($$): $175 - $275
  - Red ($$$): Over $275
- Past dates grayed out
- Click departure day, then return day — both highlight
- Click **"Apply"** button (NOT "Done" like Google Flights)
- Has a close (X) button to cancel

**Results page (travel.capitalone.com/flights/shop/...):**
- Header: "Choose departure flight to Miami (MIA, FLL)"
- Rewards balance shown in header
- Sort: Recommended (dropdown), "All filters" button
- **Fare class tabs across top**: Basic, Standard, Enhanced, Premium, Luxury
- **IMPORTANT — results layout is different from Google Flights and Amex:**
  - Each flight row shows the flight details on the LEFT
  - **Multiple fare tier price boxes horizontally** on the RIGHT
  - Example: Spirit 12:59 PM → 4:05 PM shows: Value $404 | Premium Economy $624 | Spirit First $764
  - Example: Delta 7:55 PM → 11:11 PM shows: Delta Main Basic $537 | Delta Main Classic $627 | Delta Comfort Classic $707 | Delta First Classic $867
- Click a fare tier box to expand it — shows detailed comparison:
  - Bags (carry-on, checked bag fees)
  - Flexibility (same day change, upgrade eligibility, change fees, refundability)
  - Seats (selection at check-in vs included)
  - **"Continue for $X"** button
- "X seats left at this price!" urgency indicators
- Prices show both cash AND miles: "$717 / 71,679 miles"

**CRITICAL CONSTRAINT — Same airline for round trip:**
Capital One Travel requires the SAME airline for both outbound and return on round trips. After selecting a Delta departure, the return page ONLY shows Delta flights. You cannot mix Spirit outbound + Delta return like on Google Flights. This significantly limits options and may result in higher total prices.

**Selecting return flight:**
- After clicking "Continue for $X" on departure, page shows "Choose return flight to New York City"
- Same layout — fare tiers shown horizontally per flight
- Returns are ONLY the same airline as your departure selection
- All prices show dollars AND miles (e.g., "$767 / 76,680 miles")
- Click a fare tier, expand for details, click "Continue for $X"

**Decision support — three-way comparison:**
When presenting portal results to user, compare all three:
"Google Flights: $722 (American, mix LGA outbound + MIA return). Amex Travel: $677.80 or 67,780 points (American). Capital One: $767 or 76,680 miles (Delta only — must use same airline both ways). Google Flights is cheapest, Amex saves $44 and earns points. Capital One is most expensive but you have $1,558 in travel credit to offset."

Factor in:
- Points/miles balance on each portal
- Cash equivalent value (Capital One shows this explicitly)
- Airline constraints (Capital One = same airline only)
- Which airlines are available (budget carriers may be missing from portals)

**STOP before payment on any portal** — present the comparison and let user decide which to book through.

## Step 5d: Capital One Checkout Flow (if user chooses Capital One)

After clicking "Continue | $X per traveler" on the Review Itinerary page:

**Page 1: Customize your flight** (travel.capitalone.com/flights/shop/customize/...)
- Breadcrumb: Choose Departure > Choose Return > Review Itinerary > **Customize** > Book
- "Customize your trip — Treat yourself to a trip that suits your needs."
- **Flight disruption assistance** — this is a BLOCKING upsell:
  - Covers: cancellation on day of travel, delay of 3+ hours, missed connection
  - Benefit: rebook on any airline at no additional cost (up to $5,000), or get a refund of base fare + taxes
  - Two radio buttons — MUST select one before "Continue to checkout" activates:
    - "Yes, add this option for +$130.00 / 13,000 miles per traveler"
    - "No, thanks. I don't want to add this option."
  - **"Continue to checkout"** button is GRAYED OUT until a radio button is selected
  - "Please accept or decline the options in order to proceed" warning text
- Checkout Breakdown sidebar shows: Base Fare, Taxes & Fees, Total (cash / miles)
- After selecting "No thanks": page updates to show "You declined to add this option." with "Edit" link, and "Continue to checkout" becomes active
- Default: select "No thanks" unless user specifically wants disruption protection. Could use ask_user if price is high.

**Page 2: Confirm and Book** (travel.capitalone.com/flights/book/...)
- Progress bar: 1. Add Travelers (green check) → 2. Seating → 3. Rewards & payment
- Banner: "If you find a better price elsewhere, we'll match it."
- Flight summary at top with "View details | Change" links
- **Step 1: Traveler Information**
  - "Select or Add Travelers" — saved profiles may auto-populate (checkbox pre-checked)
  - Contact info (phone, email) pre-filled from account
  - "Save and continue" button
  - **Kiki can click "Save and continue"** if traveler info is already populated
- **Step 2: Seat Selection**
  - "Choose seats" opens a MODAL overlay (not a new page)
  - Modal: "Choose Seats" — shows aircraft seat map
    - "Flight 1 of 2: JFK to FLL" with dropdown to switch flights
    - Seat types: Standard ($0.00 for Main Classic fare) and Unavailable (X marks)
    - Bottom bar: "June Pyo Suh — No seat selected" with "Next Flight" button
    - After flight 2: "Done" or "Confirm" button
  - **OR** select "Skip seats" radio: "Seats can be added on the airline website after booking, or will be assigned at check-in"
  - Sometimes seats won't be selectable — the page will indicate this
  - Default: skip seats unless user asks. Could ask_user: "Want me to pick a window or aisle seat, or skip?"
- **Step 3: Rewards and Payment**
  - "Select an account" — radio buttons:
    - "Apply Venture X rewards: 155,886 miles" — uses miles to offset cost
    - "Do not apply my rewards" — pay full cash price
  - Payment method section below
  - **ask_user opportunity**: "Apply your 155,886 Venture X miles (covers the full $766.80), or pay with card?"
  - At this point the user may prefer to finish the remaining steps themselves — the UI is simple and involves payment decisions
- **"Confirm and Book"** button — STOP GATE. Do NOT click this.
- **STOP HERE** — inform user: "I've got your flight ready on Capital One Travel. You're at the final checkout for $766.80 / 76,680 miles. Select your rewards preference and click 'Confirm and Book' when ready."

## Step 6: Airline Website Handoff (Google Flights direct booking only)

After clicking "Continue" on the fare tier:
- Browser redirects to the **airline's website** (e.g., aa.com)
- Lands on a **Passengers** or **Booking** page
- Shows trip summary with total price
- May show credit card sign-up offers (ignore unless user asks)

**On the airline site:**
- Look for "Log in" option — user may already be logged in (Chrome saved session)
- If logged in: passenger info may auto-fill
- If not logged in: look for "Enter new passenger" or "Guest checkout"
- Passenger form typically has: First Name, Last Name, Date of Birth, Gender, Email, Phone
- **STOP HERE** — inform the user you've reached the passenger information page

**Do NOT:**
- Enter passenger personal information
- Proceed to payment/credit card sections
- Click "Purchase" or "Complete booking"
- Accept travel insurance or other add-ons without asking

## Common Pitfalls

1. **Date picker requires clicking days** — typing dates into the field doesn't work reliably on Google Flights
2. **"Explore" button is NOT search** — it goes to a destination exploration map, not flight results
3. **Budget airlines charge for bags** — Spirit, Frontier show "0 carry-on, 0 checked" meaning extra fees. Factor this into "cheapest" comparisons
4. **Airline handoff may open new tab** — follow the new tab if it opens
5. **Airline sites may show login walls** — look for "Continue as guest" or "Skip" options
6. **Upsell screens** (seat selection, baggage, insurance) — skip unless user asks. Look for "Skip" or "No thanks" or "Continue without"
7. **"Top departing/returning flights" ≠ all flights** — always scroll to "Other flights" section
8. **Price on calendar vs price in results may differ** — calendar shows estimated round trip, results show actual
9. **Different departure/return airports** — when selecting city-level (e.g., "New York"), outbound may be LGA and return may land at JFK. Always flag this to user.
10. **Amex Travel defaults to Hotels tab** — must click "Flights" tab first
11. **Amex domain change** — search starts on americanexpress.com but results load on amextravel.com. Follow the redirect.
12. **Amex return pricing is incremental** — shows "+$0" not total. Don't confuse with free flights.
13. **Capital One "Customize" page is a blocking upsell** — flight disruption assistance requires explicit accept/decline before proceeding. The "Continue to checkout" button stays grayed out until you pick a radio button.
14. **Capital One seat selection is a modal** — opens over the checkout page. Close with X or select "Skip seats" to bypass.
15. **Capital One saved traveler info** — account holders have pre-populated traveler profiles and contact info. Don't try to re-enter.
16. **Portal checkout vs airline checkout** — portals (Amex, Capital One) handle the entire booking including traveler info and payment. No airline website redirect. Google Flights redirects to the airline site.

## What to Tell the User

At minimum, summarize the selected flights before proceeding:
- Airline name
- Departure: date, time, airport
- Return: date, time, airport
- Total price (round trip)
- Whether bags are included
- Any notable warnings (delays, red-eye)
`,
  },
];
