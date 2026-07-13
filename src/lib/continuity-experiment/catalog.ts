export const CONTINUITY_EXPERIMENT_STORY_IDS = [
  'elevator',
  'restaurant',
  'warehouse',
] as const

export const CONTINUITY_EXPERIMENT_VARIANT_IDS = [
  'baseline',
  'spatial',
  'continuity',
] as const

export type ContinuityExperimentStoryId = (typeof CONTINUITY_EXPERIMENT_STORY_IDS)[number]
export type ContinuityExperimentVariantId = (typeof CONTINUITY_EXPERIMENT_VARIANT_IDS)[number]

export interface ContinuityExperimentActorState {
  readonly instanceRef: string
  readonly anchorId: string
  readonly facingAnchorId: string
  readonly pose: string
}

export interface ContinuityExperimentObjectState {
  readonly objectRef: string
  readonly anchorId: string
  readonly state: string
}

export interface ContinuityExperimentShot {
  readonly id: string
  readonly camera: string
  readonly vantageId: string
  readonly action: string
  readonly composition: string
  readonly before: {
    readonly actors: readonly ContinuityExperimentActorState[]
    readonly objects: readonly ContinuityExperimentObjectState[]
  }
  readonly delta: string
  readonly after: {
    readonly actors: readonly ContinuityExperimentActorState[]
    readonly objects: readonly ContinuityExperimentObjectState[]
  }
}

export interface ContinuityExperimentStory {
  readonly id: ContinuityExperimentStoryId
  readonly difficulty: 1 | 2 | 3
  readonly logline: string
  readonly style: string
  readonly assets: readonly string[]
  readonly topology: readonly string[]
  readonly vantages: Readonly<Record<string, string>>
  readonly invariants: readonly string[]
  readonly quickShotIds: readonly string[]
  readonly shots: readonly ContinuityExperimentShot[]
}

const elevator: ContinuityExperimentStory = {
  id: 'elevator',
  difficulty: 1,
  logline: 'At night, Lin Yu enters an apartment elevator, presses floor 4, waits for the doors to close, and exits into the fourth-floor corridor.',
  style: 'cinematic graphic-novel realism, cool blue-gray apartment lighting, restrained suspense, 16:9 frame',
  assets: [
    'CHARACTER_MASTER LinYu: slim Chinese man, age 27, short slightly messy black hair, charcoal hooded jacket, gray T-shirt, black jeans, white sneakers; preserve face, hair, body proportions and clothing in every shot.',
    'LOCATION_MASTER elevator: narrow brushed-steel apartment elevator with one centered two-panel door, dark rubber floor, rear-wall horizontal handrail and one control panel on the right wall when viewed from inside facing the door.',
    'LOCATION_MASTER floor4_corridor: warm off-white corridor, green exit sign, apartment 401 opposite the elevator; preserve architecture but do not copy people, door state or display digits from any reference.',
  ],
  topology: [
    'elevator.door is on the south wall',
    'elevator.rear_wall is north, directly opposite elevator.door',
    'elevator.control_panel is on the east wall, immediately inside and to the right of elevator.door',
    'elevator.rear_handrail is centered on the north wall',
    'corridor is south of elevator.door; apartment_401 is across the corridor from the elevator',
  ],
  vantages: {
    E_A: 'corridor south of the threshold, looking north into the elevator',
    E_B: 'inside near the rear wall, looking south toward the elevator door and corridor',
    E_C: 'inside near the west wall, looking east toward the control panel',
    E_D: 'inside near the northeast corner, looking southwest across Lin Yu toward the door',
  },
  invariants: [
    'There is exactly one elevator doorway.',
    'The control panel never changes walls.',
    'The display reads 13 before the button press, then 4 only after the elevator arrives.',
    'Lin Yu cannot move from corridor to rear wall without passing through the doorway and cabin center.',
  ],
  quickShotIds: ['e2', 'e4'],
  shots: [
    {
      id: 'e1',
      camera: 'wide establishing shot',
      vantageId: 'E_A',
      action: 'The elevator doors are fully open. Lin Yu stands in the corridor one step south of the threshold, looking into the empty cabin.',
      composition: 'door frame centered; Lin Yu in lower-left foreground; rear wall and handrail visible deep inside',
      before: { actors: [{ instanceRef: 'LinYu#1', anchorId: 'corridor.south_of_threshold', facingAnchorId: 'elevator.rear_wall', pose: 'standing, arms relaxed' }], objects: [{ objectRef: 'elevator.door', anchorId: 'elevator.south_wall', state: 'fully_open' }, { objectRef: 'floor_display', anchorId: 'elevator.above_door', state: '13' }] },
      delta: 'No movement yet; establish the immutable geometry.',
      after: { actors: [{ instanceRef: 'LinYu#1', anchorId: 'corridor.south_of_threshold', facingAnchorId: 'elevator.rear_wall', pose: 'standing, weight slightly forward' }], objects: [{ objectRef: 'elevator.door', anchorId: 'elevator.south_wall', state: 'fully_open' }, { objectRef: 'floor_display', anchorId: 'elevator.above_door', state: '13' }] },
    },
    {
      id: 'e2',
      camera: 'medium-wide continuation',
      vantageId: 'E_A',
      action: 'Lin Yu crosses the threshold into the cabin and takes one step toward the center.',
      composition: 'same door-centered axis as previous shot; his trailing foot is still near the threshold',
      before: { actors: [{ instanceRef: 'LinYu#1', anchorId: 'corridor.south_of_threshold', facingAnchorId: 'elevator.rear_wall', pose: 'weight forward' }], objects: [{ objectRef: 'elevator.door', anchorId: 'elevator.south_wall', state: 'fully_open' }, { objectRef: 'floor_display', anchorId: 'elevator.above_door', state: '13' }] },
      delta: 'LinYu#1 moves corridor.south_of_threshold -> elevator.center through elevator.threshold; right foot leads.',
      after: { actors: [{ instanceRef: 'LinYu#1', anchorId: 'elevator.center', facingAnchorId: 'elevator.rear_wall', pose: 'walking, right foot planted, left foot trailing' }], objects: [{ objectRef: 'elevator.door', anchorId: 'elevator.south_wall', state: 'fully_open' }, { objectRef: 'floor_display', anchorId: 'elevator.above_door', state: '13' }] },
    },
    {
      id: 'e3',
      camera: 'medium side shot',
      vantageId: 'E_C',
      action: 'Lin Yu pivots right toward the control panel and extends his right index finger toward button 4.',
      composition: 'control panel fills right third; Lin Yu remains in cabin center-left; door edge visible behind him',
      before: { actors: [{ instanceRef: 'LinYu#1', anchorId: 'elevator.center', facingAnchorId: 'elevator.rear_wall', pose: 'finishing a step' }], objects: [{ objectRef: 'button_4', anchorId: 'elevator.control_panel', state: 'unlit' }, { objectRef: 'elevator.door', anchorId: 'elevator.south_wall', state: 'fully_open' }] },
      delta: 'LinYu#1 rotates clockwise from north to east; right arm rises from side to chest height.',
      after: { actors: [{ instanceRef: 'LinYu#1', anchorId: 'elevator.center_east', facingAnchorId: 'elevator.control_panel', pose: 'right arm extended, index finger 2 cm from button 4' }], objects: [{ objectRef: 'button_4', anchorId: 'elevator.control_panel', state: 'unlit' }, { objectRef: 'elevator.door', anchorId: 'elevator.south_wall', state: 'fully_open' }] },
    },
    {
      id: 'e4',
      camera: 'close medium insert with face and hand',
      vantageId: 'E_C',
      action: 'His right index finger depresses button 4; the circular button lights amber.',
      composition: 'hand and button are foreground-right, his profile remains visible left; preserve right-hand anatomy',
      before: { actors: [{ instanceRef: 'LinYu#1', anchorId: 'elevator.center_east', facingAnchorId: 'elevator.control_panel', pose: 'right index finger hovering at button 4' }], objects: [{ objectRef: 'button_4', anchorId: 'elevator.control_panel', state: 'unlit' }, { objectRef: 'floor_display', anchorId: 'elevator.above_door', state: '13' }] },
      delta: 'Right index finger moves forward 2 cm and depresses button 4; button changes unlit -> amber_lit.',
      after: { actors: [{ instanceRef: 'LinYu#1', anchorId: 'elevator.center_east', facingAnchorId: 'elevator.control_panel', pose: 'right index finger touching depressed button 4' }], objects: [{ objectRef: 'button_4', anchorId: 'elevator.control_panel', state: 'amber_lit' }, { objectRef: 'floor_display', anchorId: 'elevator.above_door', state: '13' }] },
    },
    {
      id: 'e5',
      camera: 'medium shot toward the doorway',
      vantageId: 'E_D',
      action: 'Lin Yu lowers his right arm and turns toward the doors as the two door panels nearly meet.',
      composition: 'Lin Yu center-right; shrinking vertical corridor gap center-left; control panel stays on east wall behind camera side',
      before: { actors: [{ instanceRef: 'LinYu#1', anchorId: 'elevator.center_east', facingAnchorId: 'elevator.control_panel', pose: 'finger just leaving button' }], objects: [{ objectRef: 'button_4', anchorId: 'elevator.control_panel', state: 'amber_lit' }, { objectRef: 'elevator.door', anchorId: 'elevator.south_wall', state: 'fully_open' }] },
      delta: 'LinYu#1 lowers right arm and rotates east -> south; elevator.door changes fully_open -> almost_closed.',
      after: { actors: [{ instanceRef: 'LinYu#1', anchorId: 'elevator.center_east', facingAnchorId: 'elevator.door', pose: 'standing, both arms down' }], objects: [{ objectRef: 'button_4', anchorId: 'elevator.control_panel', state: 'amber_lit' }, { objectRef: 'elevator.door', anchorId: 'elevator.south_wall', state: 'almost_closed' }] },
    },
    {
      id: 'e6',
      camera: 'reverse medium-wide exit shot',
      vantageId: 'E_B',
      action: 'On floor 4 the doors are fully open. Lin Yu steps south out into the corridor toward apartment 401.',
      composition: 'view from rear wall through the single doorway; Lin Yu crosses threshold; 401 visible across corridor',
      before: { actors: [{ instanceRef: 'LinYu#1', anchorId: 'elevator.center_east', facingAnchorId: 'elevator.door', pose: 'waiting, arms down' }], objects: [{ objectRef: 'floor_display', anchorId: 'elevator.above_door', state: '4' }, { objectRef: 'elevator.door', anchorId: 'elevator.south_wall', state: 'fully_open' }] },
      delta: 'LinYu#1 moves elevator.center_east -> corridor.south_of_threshold through elevator.threshold; left foot leads.',
      after: { actors: [{ instanceRef: 'LinYu#1', anchorId: 'corridor.south_of_threshold', facingAnchorId: 'corridor.apartment_401', pose: 'walking, left foot planted outside' }], objects: [{ objectRef: 'floor_display', anchorId: 'elevator.above_door', state: '4' }, { objectRef: 'elevator.door', anchorId: 'elevator.south_wall', state: 'fully_open' }] },
    },
  ],
}

const restaurant: ContinuityExperimentStory = {
  id: 'restaurant',
  difficulty: 2,
  logline: 'In a compact restaurant, Mei secretly passes a red envelope to Chen while a waiter crosses behind them; Chen hides it before the waiter returns.',
  style: 'cinematic graphic-novel realism, warm tungsten restaurant light with teal street spill, quiet tension, 16:9 frame',
  assets: [
    'CHARACTER_MASTER Mei#1: Chinese woman, age 31, straight shoulder-length black hair, cream trench coat over dark green blouse, small silver earrings.',
    'CHARACTER_MASTER Chen#1: Chinese man, age 35, rectangular glasses, navy suit, white shirt without tie, silver watch on left wrist.',
    'CHARACTER_MASTER Waiter#1: Chinese man, age 22, white shirt, dark red apron, carries a round black tray.',
    'PROP_MASTER red_envelope#1: matte scarlet paper envelope with one small gold seal; there is exactly one envelope.',
  ],
  topology: [
    'table_7 is centered between west banquette and east aisle',
    'Mei seat is west of table_7; Chen seat is east of table_7',
    'service_door is north of table_7; street_window is south',
    'waiter path runs north-south through east aisle and never crosses through table_7',
  ],
  vantages: {
    R_A: 'south near street window, looking north across table_7 toward service door',
    R_B: 'northwest banquette corner, looking southeast across Mei toward Chen',
    R_C: 'northeast aisle edge, looking southwest across Chen toward Mei',
    R_D: 'table-height close vantage on south edge, looking north at both hands',
  },
  invariants: [
    'Mei stays west and Chen stays east of table_7 until shot r6.',
    'There is exactly one red envelope; ownership changes Mei -> Chen.',
    'Waiter remains in the east aisle and may occlude Chen but never swaps sides with Mei.',
    'Chen uses his right hand to receive the envelope and hides it inside his jacket with that same hand.',
  ],
  quickShotIds: ['r3', 'r5'],
  shots: [
    {
      id: 'r1', camera: 'wide two-shot', vantageId: 'R_A',
      action: 'Mei sits west and Chen sits east at table 7. The waiter emerges from the northern service door into the east aisle carrying a tray.',
      composition: 'table centered; Mei frame-left; Chen frame-right; waiter deep background-right',
      before: { actors: [{ instanceRef: 'Mei#1', anchorId: 'table7.west_seat', facingAnchorId: 'table7.east_seat', pose: 'seated upright, hands below table' }, { instanceRef: 'Chen#1', anchorId: 'table7.east_seat', facingAnchorId: 'table7.west_seat', pose: 'seated, forearms on table' }, { instanceRef: 'Waiter#1', anchorId: 'service_door', facingAnchorId: 'aisle.south', pose: 'stepping out with tray in left hand' }], objects: [{ objectRef: 'red_envelope#1', anchorId: 'Mei.coat_inner_pocket', state: 'hidden' }] },
      delta: 'Establish fixed seating and waiter path.',
      after: { actors: [{ instanceRef: 'Mei#1', anchorId: 'table7.west_seat', facingAnchorId: 'table7.east_seat', pose: 'seated upright, right hand inside coat' }, { instanceRef: 'Chen#1', anchorId: 'table7.east_seat', facingAnchorId: 'table7.west_seat', pose: 'seated, forearms on table' }, { instanceRef: 'Waiter#1', anchorId: 'aisle.north', facingAnchorId: 'aisle.south', pose: 'walking south with tray level' }], objects: [{ objectRef: 'red_envelope#1', anchorId: 'Mei.coat_inner_pocket', state: 'hidden' }] },
    },
    {
      id: 'r2', camera: 'medium on Mei and tabletop', vantageId: 'R_B',
      action: 'Mei removes the red envelope with her right hand and slides it onto the west edge of the tabletop under a folded menu.',
      composition: 'Mei foreground-left; envelope partially visible under menu; Chen across table background-right',
      before: { actors: [{ instanceRef: 'Mei#1', anchorId: 'table7.west_seat', facingAnchorId: 'table7.east_seat', pose: 'right hand inside coat' }, { instanceRef: 'Chen#1', anchorId: 'table7.east_seat', facingAnchorId: 'table7.west_seat', pose: 'watching Mei' }], objects: [{ objectRef: 'red_envelope#1', anchorId: 'Mei.coat_inner_pocket', state: 'hidden' }] },
      delta: 'Mei right hand moves envelope coat_inner_pocket -> tabletop.west_edge; menu covers its north half.',
      after: { actors: [{ instanceRef: 'Mei#1', anchorId: 'table7.west_seat', facingAnchorId: 'table7.east_seat', pose: 'right fingertips resting on menu' }, { instanceRef: 'Chen#1', anchorId: 'table7.east_seat', facingAnchorId: 'tabletop.west_edge', pose: 'eyes lowered toward menu' }], objects: [{ objectRef: 'red_envelope#1', anchorId: 'tabletop.west_edge', state: 'half_hidden_under_menu' }] },
    },
    {
      id: 'r3', camera: 'table-height hand close-up', vantageId: 'R_D',
      action: 'Mei pushes the menu and envelope east across the table; Chen reaches with his right hand but has not touched it yet.',
      composition: 'Mei right hand enters frame-left; Chen right hand enters frame-right; single envelope centered',
      before: { actors: [{ instanceRef: 'Mei#1', anchorId: 'table7.west_seat', facingAnchorId: 'table7.east_seat', pose: 'right fingertips on menu' }, { instanceRef: 'Chen#1', anchorId: 'table7.east_seat', facingAnchorId: 'tabletop.west_edge', pose: 'right hand near water glass' }], objects: [{ objectRef: 'red_envelope#1', anchorId: 'tabletop.west_edge', state: 'half_hidden_under_menu' }] },
      delta: 'Envelope slides west_edge -> table_center under menu; Chen right hand moves toward but remains 5 cm away.',
      after: { actors: [{ instanceRef: 'Mei#1', anchorId: 'table7.west_seat', facingAnchorId: 'table7.east_seat', pose: 'right arm extended to table center' }, { instanceRef: 'Chen#1', anchorId: 'table7.east_seat', facingAnchorId: 'table_center', pose: 'right hand open, 5 cm from envelope' }], objects: [{ objectRef: 'red_envelope#1', anchorId: 'tabletop.center', state: 'half_hidden_under_menu' }] },
    },
    {
      id: 'r4', camera: 'reverse medium on Chen', vantageId: 'R_C',
      action: 'Chen takes the envelope with his right hand as the waiter passes south behind his right shoulder, briefly occluding part of Chen.',
      composition: 'Chen foreground-center; waiter crossing background-right to foreground-right; Mei visible across table-left',
      before: { actors: [{ instanceRef: 'Chen#1', anchorId: 'table7.east_seat', facingAnchorId: 'tabletop.center', pose: 'right hand open near envelope' }, { instanceRef: 'Waiter#1', anchorId: 'aisle.north', facingAnchorId: 'aisle.south', pose: 'walking with tray' }], objects: [{ objectRef: 'red_envelope#1', anchorId: 'tabletop.center', state: 'under_menu' }] },
      delta: 'Chen right hand grips envelope and moves it center -> east_edge; Waiter moves aisle.north -> aisle.mid without changing lane.',
      after: { actors: [{ instanceRef: 'Chen#1', anchorId: 'table7.east_seat', facingAnchorId: 'table7.west_seat', pose: 'right hand gripping envelope at table edge' }, { instanceRef: 'Waiter#1', anchorId: 'aisle.mid', facingAnchorId: 'aisle.south', pose: 'walking, tray level, partially occluding Chen right shoulder' }], objects: [{ objectRef: 'red_envelope#1', anchorId: 'Chen.right_hand', state: 'gripped' }] },
    },
    {
      id: 'r5', camera: 'tight medium on Chen torso', vantageId: 'R_C',
      action: 'With the waiter continuing south, Chen slips the same envelope into the inside left breast of his jacket using his right hand.',
      composition: 'Chen centered; right hand crosses torso; waiter blurred at far-right edge; Mei remains across table-left background',
      before: { actors: [{ instanceRef: 'Chen#1', anchorId: 'table7.east_seat', facingAnchorId: 'table7.west_seat', pose: 'right hand gripping envelope at table edge' }, { instanceRef: 'Waiter#1', anchorId: 'aisle.mid', facingAnchorId: 'aisle.south', pose: 'walking south' }], objects: [{ objectRef: 'red_envelope#1', anchorId: 'Chen.right_hand', state: 'gripped' }] },
      delta: 'Chen right hand carries envelope across torso into jacket.left_inner_pocket; Waiter moves aisle.mid -> aisle.south.',
      after: { actors: [{ instanceRef: 'Chen#1', anchorId: 'table7.east_seat', facingAnchorId: 'table7.west_seat', pose: 'right hand inside left jacket opening' }, { instanceRef: 'Waiter#1', anchorId: 'aisle.south', facingAnchorId: 'aisle.south', pose: 'walking out of frame' }], objects: [{ objectRef: 'red_envelope#1', anchorId: 'Chen.jacket_left_inner_pocket', state: 'hidden' }] },
    },
    {
      id: 'r6', camera: 'wide two-shot continuation', vantageId: 'R_A',
      action: 'The waiter has exited south. Chen withdraws his empty right hand and both diners resume neutral conversation without changing seats.',
      composition: 'same geometry as r1; Mei left, Chen right; east aisle empty',
      before: { actors: [{ instanceRef: 'Mei#1', anchorId: 'table7.west_seat', facingAnchorId: 'table7.east_seat', pose: 'seated, watching Chen' }, { instanceRef: 'Chen#1', anchorId: 'table7.east_seat', facingAnchorId: 'table7.west_seat', pose: 'right hand inside jacket' }], objects: [{ objectRef: 'red_envelope#1', anchorId: 'Chen.jacket_left_inner_pocket', state: 'hidden' }] },
      delta: 'Chen withdraws empty right hand to tabletop; all positions remain fixed.',
      after: { actors: [{ instanceRef: 'Mei#1', anchorId: 'table7.west_seat', facingAnchorId: 'table7.east_seat', pose: 'seated, hands folded' }, { instanceRef: 'Chen#1', anchorId: 'table7.east_seat', facingAnchorId: 'table7.west_seat', pose: 'seated, empty right hand beside glass' }], objects: [{ objectRef: 'red_envelope#1', anchorId: 'Chen.jacket_left_inner_pocket', state: 'hidden' }] },
    },
  ],
}

const warehouse: ContinuityExperimentStory = {
  id: 'warehouse',
  difficulty: 3,
  logline: 'In a warehouse, courier Aya uses a yellow crate as cover while guard Bo and mechanic Kai converge from different levels; Aya transfers a silver case to Kai through a loading-bay gate.',
  style: 'cinematic graphic-novel realism, sodium-vapor warehouse light, blue moonlight shafts, tense action clarity, 16:9 frame',
  assets: [
    'CHARACTER_MASTER Aya#1: East Asian woman, age 29, short black bob, red courier jacket with white shoulder stripe, black cargo pants, gray sneakers.',
    'CHARACTER_MASTER Bo#1: large East Asian man, age 42, shaved head, dark green security jacket, black flashlight in right hand.',
    'CHARACTER_MASTER Kai#1: lean East Asian man, age 33, wavy hair, blue mechanic coveralls, orange work gloves.',
    'PROP_MASTER silver_case#1: small brushed-aluminum hard case with black handle; exactly one case.',
  ],
  topology: [
    'loading_gate is on the east wall; office_door is on the west wall',
    'yellow_crate is fixed slightly west of warehouse center and creates a north and south cover side',
    'forklift_lane runs west-east along the south side of yellow_crate',
    'metal_stairs rise from northeast floor to catwalk_north',
    'catwalk_north overlooks the floor; its railing never moves',
  ],
  vantages: {
    W_A: 'southwest high corner, looking northeast across floor to loading gate and stairs',
    W_B: 'west office door, looking east along forklift lane toward loading gate',
    W_C: 'east loading gate, looking west past yellow crate toward office door',
    W_D: 'catwalk north railing, looking down south onto yellow crate and forklift lane',
  },
  invariants: [
    'Aya begins west of the yellow crate, Bo begins at the west office door, and Kai begins on the north catwalk.',
    'The silver case is always held by exactly one person or resting at one explicit anchor.',
    'Bo never teleports through the yellow crate; he must move around its south side.',
    'Kai reaches the east loading gate only by descending the northeast stairs.',
  ],
  quickShotIds: ['w3', 'w6'],
  shots: [
    {
      id: 'w1', camera: 'high wide establishing shot', vantageId: 'W_A',
      action: 'Aya crouches west of the yellow crate holding the silver case in her left hand. Bo enters through the west office door. Kai watches from the north catwalk.',
      composition: 'yellow crate center; Aya left-center low; Bo far-left; Kai upper-right; loading gate far-right',
      before: { actors: [{ instanceRef: 'Aya#1', anchorId: 'crate.west_side', facingAnchorId: 'loading_gate', pose: 'crouched, case in left hand' }, { instanceRef: 'Bo#1', anchorId: 'office_door', facingAnchorId: 'crate.west_side', pose: 'entering, flashlight in right hand' }, { instanceRef: 'Kai#1', anchorId: 'catwalk_north', facingAnchorId: 'crate.west_side', pose: 'leaning over railing' }], objects: [{ objectRef: 'silver_case#1', anchorId: 'Aya.left_hand', state: 'gripped_closed' }] },
      delta: 'Establish all three levels, paths and ownership.',
      after: { actors: [{ instanceRef: 'Aya#1', anchorId: 'crate.west_side', facingAnchorId: 'crate.south_side', pose: 'crouched, preparing to move' }, { instanceRef: 'Bo#1', anchorId: 'office_door_inside', facingAnchorId: 'crate.west_side', pose: 'standing, flashlight raised' }, { instanceRef: 'Kai#1', anchorId: 'catwalk_north', facingAnchorId: 'northeast_stairs', pose: 'turning toward stairs' }], objects: [{ objectRef: 'silver_case#1', anchorId: 'Aya.left_hand', state: 'gripped_closed' }] },
    },
    {
      id: 'w2', camera: 'low tracking medium', vantageId: 'W_B',
      action: 'Aya moves clockwise around the south end of the yellow crate, staying crouched with the case in her left hand. Bo advances east along the same lane behind her.',
      composition: 'forklift lane recedes east; Aya foreground-center; crate blocks her north side; Bo deep-left background',
      before: { actors: [{ instanceRef: 'Aya#1', anchorId: 'crate.west_side', facingAnchorId: 'crate.south_side', pose: 'crouched with case left' }, { instanceRef: 'Bo#1', anchorId: 'office_door_inside', facingAnchorId: 'crate.west_side', pose: 'flashlight raised' }], objects: [{ objectRef: 'silver_case#1', anchorId: 'Aya.left_hand', state: 'gripped_closed' }] },
      delta: 'Aya moves crate.west_side -> crate.southwest_corner; Bo moves office_door_inside -> forklift_lane.west, remaining behind Aya.',
      after: { actors: [{ instanceRef: 'Aya#1', anchorId: 'crate.southwest_corner', facingAnchorId: 'loading_gate', pose: 'crouch-running, case left, right hand near floor' }, { instanceRef: 'Bo#1', anchorId: 'forklift_lane.west', facingAnchorId: 'crate.southwest_corner', pose: 'walking fast, flashlight right' }], objects: [{ objectRef: 'silver_case#1', anchorId: 'Aya.left_hand', state: 'gripped_closed' }] },
    },
    {
      id: 'w3', camera: 'overhead diagonal action shot', vantageId: 'W_D',
      action: 'Kai descends the northeast stairs while Aya crosses the south side of the crate. Bo rounds the southwest corner two meters behind her.',
      composition: 'clear triangular staging: Kai upper-right stairs, Aya lower-center, Bo lower-left; crate separates paths',
      before: { actors: [{ instanceRef: 'Aya#1', anchorId: 'crate.southwest_corner', facingAnchorId: 'loading_gate', pose: 'crouch-running with case left' }, { instanceRef: 'Bo#1', anchorId: 'forklift_lane.west', facingAnchorId: 'crate.southwest_corner', pose: 'fast walk' }, { instanceRef: 'Kai#1', anchorId: 'catwalk_north', facingAnchorId: 'northeast_stairs', pose: 'starting descent' }], objects: [{ objectRef: 'silver_case#1', anchorId: 'Aya.left_hand', state: 'gripped_closed' }] },
      delta: 'Aya southwest_corner -> crate.south_side; Bo lane.west -> southwest_corner; Kai catwalk -> stairs.mid. Preserve two-meter order Aya ahead of Bo.',
      after: { actors: [{ instanceRef: 'Aya#1', anchorId: 'crate.south_side', facingAnchorId: 'loading_gate', pose: 'running east, case left' }, { instanceRef: 'Bo#1', anchorId: 'crate.southwest_corner', facingAnchorId: 'crate.south_side', pose: 'rounding corner, flashlight right' }, { instanceRef: 'Kai#1', anchorId: 'northeast_stairs.mid', facingAnchorId: 'loading_gate', pose: 'descending, left hand on rail' }], objects: [{ objectRef: 'silver_case#1', anchorId: 'Aya.left_hand', state: 'gripped_closed' }] },
    },
    {
      id: 'w4', camera: 'medium from loading gate', vantageId: 'W_C',
      action: 'Aya reaches the east side of the yellow crate and sees Kai stepping off the stairs beside the loading gate. Bo is partially hidden behind the crate south edge.',
      composition: 'Aya midground-left facing camera-right; Kai foreground-right; Bo only partially visible background-left of crate',
      before: { actors: [{ instanceRef: 'Aya#1', anchorId: 'crate.south_side', facingAnchorId: 'loading_gate', pose: 'running with case left' }, { instanceRef: 'Bo#1', anchorId: 'crate.southwest_corner', facingAnchorId: 'crate.south_side', pose: 'pursuing' }, { instanceRef: 'Kai#1', anchorId: 'northeast_stairs.mid', facingAnchorId: 'loading_gate', pose: 'descending' }], objects: [{ objectRef: 'silver_case#1', anchorId: 'Aya.left_hand', state: 'gripped_closed' }] },
      delta: 'Aya south_side -> crate.east_side; Kai stairs.mid -> stairs.bottom; Bo southwest_corner -> south_side and becomes partly occluded by crate.',
      after: { actors: [{ instanceRef: 'Aya#1', anchorId: 'crate.east_side', facingAnchorId: 'loading_gate', pose: 'half-standing, case left extended slightly' }, { instanceRef: 'Bo#1', anchorId: 'crate.south_side', facingAnchorId: 'crate.east_side', pose: 'running, lower body occluded by crate' }, { instanceRef: 'Kai#1', anchorId: 'northeast_stairs.bottom', facingAnchorId: 'crate.east_side', pose: 'stepping onto floor, right hand ready' }], objects: [{ objectRef: 'silver_case#1', anchorId: 'Aya.left_hand', state: 'gripped_closed' }] },
    },
    {
      id: 'w5', camera: 'tight two-shot at gate', vantageId: 'W_C',
      action: 'Aya transfers the silver case from her left hand into Kai’s right hand through the half-open loading gate.',
      composition: 'single case centered between hands; Aya frame-left inside warehouse; Kai frame-right at gate; gate bars preserve separation',
      before: { actors: [{ instanceRef: 'Aya#1', anchorId: 'crate.east_side', facingAnchorId: 'loading_gate', pose: 'left arm extending case' }, { instanceRef: 'Kai#1', anchorId: 'loading_gate.inside', facingAnchorId: 'crate.east_side', pose: 'right hand open toward case' }], objects: [{ objectRef: 'silver_case#1', anchorId: 'Aya.left_hand', state: 'gripped_closed' }] },
      delta: 'Case ownership changes Aya.left_hand -> shared_contact -> Kai.right_hand; no duplicate case. Aya releases only after Kai grips handle.',
      after: { actors: [{ instanceRef: 'Aya#1', anchorId: 'loading_gate.inside_west', facingAnchorId: 'loading_gate', pose: 'left hand open after release' }, { instanceRef: 'Kai#1', anchorId: 'loading_gate.inside_east', facingAnchorId: 'crate.east_side', pose: 'right hand gripping case handle' }], objects: [{ objectRef: 'silver_case#1', anchorId: 'Kai.right_hand', state: 'gripped_closed' }] },
    },
    {
      id: 'w6', camera: 'wide cross-axis climax', vantageId: 'W_A',
      action: 'Kai exits east through the gate carrying the case. Aya slams the gate shut with both hands while Bo stops one step behind her on the warehouse side.',
      composition: 'gate far-right; Kai outside-right with case; Aya at gate center-right; Bo directly west behind Aya; crate remains center-left',
      before: { actors: [{ instanceRef: 'Aya#1', anchorId: 'loading_gate.inside_west', facingAnchorId: 'loading_gate', pose: 'left hand open' }, { instanceRef: 'Kai#1', anchorId: 'loading_gate.inside_east', facingAnchorId: 'loading_gate.outside', pose: 'case in right hand' }, { instanceRef: 'Bo#1', anchorId: 'crate.east_side', facingAnchorId: 'loading_gate', pose: 'running toward Aya' }], objects: [{ objectRef: 'silver_case#1', anchorId: 'Kai.right_hand', state: 'gripped_closed' }, { objectRef: 'loading_gate', anchorId: 'warehouse.east_wall', state: 'half_open' }] },
      delta: 'Kai moves inside_east -> gate.outside; Aya pushes gate half_open -> closed; Bo moves crate.east_side -> gate.inside_west_rear and stops behind Aya.',
      after: { actors: [{ instanceRef: 'Aya#1', anchorId: 'loading_gate.inside_west', facingAnchorId: 'loading_gate', pose: 'both palms braced on closed gate' }, { instanceRef: 'Kai#1', anchorId: 'loading_gate.outside', facingAnchorId: 'outside.east', pose: 'running away, case in right hand' }, { instanceRef: 'Bo#1', anchorId: 'loading_gate.inside_west_rear', facingAnchorId: 'Aya#1', pose: 'stopped one step behind Aya, flashlight lowered' }], objects: [{ objectRef: 'silver_case#1', anchorId: 'Kai.right_hand', state: 'gripped_closed' }, { objectRef: 'loading_gate', anchorId: 'warehouse.east_wall', state: 'closed' }] },
    },
  ],
}

export const CONTINUITY_EXPERIMENT_STORIES: readonly ContinuityExperimentStory[] = [
  elevator,
  restaurant,
  warehouse,
]

export function findContinuityExperimentStory(storyId: ContinuityExperimentStoryId) {
  const story = CONTINUITY_EXPERIMENT_STORIES.find((item) => item.id === storyId)
  if (!story) throw new Error(`CONTINUITY_EXPERIMENT_STORY_NOT_FOUND:${storyId}`)
  return story
}

export function findContinuityExperimentShot(story: ContinuityExperimentStory, shotId: string) {
  const shot = story.shots.find((item) => item.id === shotId)
  if (!shot) throw new Error(`CONTINUITY_EXPERIMENT_SHOT_NOT_FOUND:${story.id}:${shotId}`)
  return shot
}
