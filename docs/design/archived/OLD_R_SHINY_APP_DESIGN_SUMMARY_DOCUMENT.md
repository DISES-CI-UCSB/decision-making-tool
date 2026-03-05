# Where To Work - Design Document
*Comprehensive overview of current features, data, and components*

## 1. Application Overview

**Where To Work** is an interactive systematic conservation planning application developed for the Nature Conservancy of Canada. It uses mathematical optimization algorithms to help prioritize conservation efforts by generating spatial prioritization solutions.

### Core Purpose
- Interactive decision support tool for conservation planning
- Uses exact optimization algorithms (Gurobi/CBC solvers) via the prioritizr R package
- Generates optimal spatial prioritizations based on conservation themes, weights, includes, and excludes
- Built as a Shiny web application using the golem framework

### Technology Stack
- **Backend**: R Shiny application (golem framework)
- **Frontend**: Leaflet.js for interactive maps, custom HTML widgets
- **Optimization**: prioritizr R package with Gurobi or CBC solvers
- **Data Format**: Raster/vector spatial data summarized by planning units

---

## 2. User Workflows: The Big Picture

*This section provides the mental model for how users interact with the tool. For detailed technical workflows, see Section 9. For terminology definitions, see the Glossary (Appendix A).*

### Simplified User Journey (3 Main Steps)

```
STEP 1: LOAD DATA
"Get my conservation planning data into the tool"
↓
User Action: Select a study area/project
Result: Map displays with data layers available

STEP 2: CONFIGURE & GENERATE
"Tell the tool what I want to achieve"
↓
User Actions:
- Set goals for conservation features (e.g., "protect 30% of grizzly bear habitat")
- Choose what's important (weights like cost, connectivity)
- Mark areas that must be included/excluded
- Set constraints (budget, clustering level)
- Click "Optimize"
↓
Result: Tool generates a solution (which planning units to protect)
Wait time: 2-10 minutes

STEP 3: EXPLORE & DECIDE
"Understand what the solution achieves and what it costs"
↓
User Actions:
- View solution on map (see spatial pattern)
- Review statistics (goals met? area needed? cost?)
- Compare trade-offs (what you get vs. what you give up)
- Download results or try different scenarios
↓
Result: Informed decision about conservation priorities
```

### Current Tool: Detailed 5-Stage Workflow

For users familiar with the tool, here's the complete workflow:

#### Stage 1: Data Loading
```
User uploads or selects built-in project
    ↓
System validates spatial data, attributes, boundaries
    ↓
Creates internal data structures (Dataset, Variables, Themes, Weights, etc.)
    ↓
Renders initial map view with available layers
```

#### Stage 2: Parameter Configuration
```
User opens "New Solution" pane (right sidebar)
    ↓
Configures Themes:
  - Enable/disable conservation features
  - Set goals (target % to protect)
    ↓
Configures Weights:
  - Enable/disable factors
  - Set importance (-100 to +100)
    ↓
Configures Includes/Excludes:
  - Toggle constraints on/off
    ↓
Sets Global Parameters:
  - Area budget (optional)
  - Spatial clustering level
  - Optimality gap tolerance
    ↓
Names solution and picks display color
```

#### Stage 3: Solution Generation ⏱️
```
User clicks "Optimize" button
    ↓
System formulates mathematical optimization problem
    ↓
Stage 1 optimization: Meet goals efficiently (10% gap)
    ↓
Stage 2 optimization: Add spatial clustering (15% gap, if enabled)
    ↓
Calculate comprehensive statistics
    ↓
Solution ready (2-10 minutes elapsed)
```

#### Stage 4: Results Exploration
```
Solution Results pane opens automatically
    ↓
User reviews multiple tabs:
  - Summary: Overall statistics (area, # reserves, etc.)
  - Themes: Did we meet conservation goals? (✓/✗)
  - Weights: What costs/benefits were captured?
  - Includes/Excludes: Were constraints honored?
    ↓
User toggles solution visibility on map
    ↓
User compares spatial pattern to other layers
```

#### Stage 5: Decision & Iteration
```
User evaluates solution quality
    ↓
Option A: Satisfied → Download solution + results → Done
    ↓
Option B: Not satisfied → Adjust parameters → Return to Stage 2
    ↓
Option C: Compare scenarios → Generate additional solutions → Compare results
```

### Key Concepts (Quick Reference)

Before diving deeper, here are the essential terms you'll encounter:

- **Planning Unit**: A grid cell or polygon; the tool selects which units to protect
- **Theme/Feature**: Conservation targets with goals (e.g., "protect 30% of species habitat")
- **Weight**: Factors that influence selection without explicit goals (e.g., "avoid expensive areas")
- **Include**: Areas that must be in the solution (locked-in)
- **Exclude**: Areas that cannot be in the solution (locked-out)
- **Solution**: The output - which planning units to prioritize for conservation
- **Goal**: Target percentage to protect (for themes)
- **Factor**: Importance value for weights (-100 to +100)

*For complete terminology definitions, see the Glossary in Appendix A at the end of this document.*

---

## 3. Terminology Quick Reference

*This section provides key terms you'll encounter while using the tool. For complete definitions of all terms, settings, and technical concepts, see **Appendix A: Complete Glossary** at the end of this document.*

**Essential Terms:**
- **Planning Unit** - A grid cell or polygon that can be selected for protection
- **Theme/Feature** - Conservation targets with percentage goals (e.g., "protect 30% of bear habitat")
- **Weight** - Influence factors without goals (e.g., "avoid expensive areas with factor -80")
- **Include** - Areas that must be selected (locked-in)
- **Exclude** - Areas that cannot be selected (locked-out)
- **Solution** - The optimization output showing which units to protect
- **Goal** - Target percentage for a conservation feature
- **Factor** - Importance value for a weight (-100 to +100)
- **Budget** - Maximum area constraint

*→ See Appendix A for complete glossary with 80+ terms and detailed explanations.*

---

## 4. Application Structure

### Main UI Layout

```
┌─────────────────────────────────────────────────┐
│           Colombia Header (customized)           │
├─────────┬───────────────────────────┬───────────┤
│  LEFT   │                           │   RIGHT   │
│ SIDEBAR │      LEAFLET MAP          │  SIDEBAR  │
│         │                           │           │
│ Layer   │   Spatial Visualization   │ Configure │
│ Control │                           │ & Results │
└─────────┴───────────────────────────┴───────────┘
```

### Sidebar Roles

**LEFT Sidebar:** Controls map layer visibility
- Toggle any layer on/off (eye icon)
- Reorder layers (drag and drop)
- View legends
- *Does not configure optimization parameters*

**RIGHT Sidebar:** Configure optimization and view results
- **New Solution Pane:** Set all parameters (goals, factors, includes/excludes, budget, etc.) → Click "Optimize"
- **Solution Results Pane:** Review statistics and goal achievement (opens automatically after optimization)
- *Does not control map visibility*

**CENTER Map:** Displays spatial data and solutions visually

---

### Left Sidebar: Data Visualization (View Only)

*Purpose: Control what you see on the map. No optimization settings here.*

Contains 4 panes accessible via icons:

#### 1. **Map Manager Pane** (`layer-group` icon) 
**What it does:** Table of contents for visualizing data layers

**Actions:**
- ✅ Toggle layer visibility (eye icon 👁️) - show/hide on map
- ✅ Reorder layers via drag-and-drop - change drawing order
- ✅ View legends for each layer

**What you see:**
- All available data layers: themes (⭐), weights (⚖️), includes (🔒), excludes (🚫)
- Generated solutions (after optimization)

**Important:** This pane only controls visualization (what's visible on the map). It does NOT set optimization parameters. To configure includes/excludes for optimization, use the RIGHT sidebar → New Solution Pane.

#### 2. **Export Pane** (`download` icon)
**What it does:** Download data and results

**Actions:**
- Download spatial datasets (themes, weights, includes, excludes)
- Download solutions with performance statistics
- Export to raster or vector formats
- Generate Excel spreadsheets with results

#### 3. **Contact Pane** (`envelope` icon)
**What it does:** Development team contact information

#### 4. **Acknowledgments Pane** (`heart` icon)
**What it does:** Credits for contributors, organizations, and open source software

---

### Right Sidebar: Configuration & Analysis (Action & Results)

*Purpose: Set optimization parameters, generate solutions, and review results.*

Contains 2 panes:

#### 1. **New Solution Pane** (`rocket` icon) ← THIS IS WHERE YOU CONFIGURE EVERYTHING

**What it does:** Configure all optimization parameters before generating a solution

**Contains 5 sub-panels:**

##### **A. Themes Panel** (Conservation Features)
**Configure:**
- ☑️ Enable/disable each feature
- 🎯 Set goals (% to protect) - e.g., "Protect 30% of grizzly bear habitat"

##### **B. Weights Panel** (Influence Factors)
**Configure:**
- ☑️ Enable/disable each weight
- 🎚️ Set factors (-100 to +100) - e.g., "-75 to avoid expensive areas"

##### **C. Includes Panel** (Lock-In Constraints) ← ANSWER TO YOUR QUESTION
**Configure:**
- ☑️ Toggle on/off - When ON, these areas MUST be in the solution
- Example: Turn ON "Existing Protected Areas" to force them into the solution

##### **D. Excludes Panel** (Lock-Out Constraints) ← ANSWER TO YOUR QUESTION
**Configure:**
- ☑️ Toggle on/off - When ON, these areas CANNOT be in the solution
- Example: Turn ON "Urban Areas" to prevent them from being selected

##### **E. Settings Panel** (Global Parameters)
**Configure:**
- 💰 Area budget limit (optional)
- 🔗 Spatial clustering level (0-100)
- ⚡ Optimality gap tolerance (%)
- ⏱️ Time limits

**Bottom Section:**
- Name your solution
- Pick display color
- **[OPTIMIZE]** button ← Click to generate solution

---

#### 2. **Solution Results Pane** (`tachometer-alt` icon)

**What it does:** Display comprehensive results after optimization

**Opens automatically** after clicking "Optimize" button

**Contains 5 tabs:**
1. **Summary** - Overall statistics and parameters
2. **Themes** - Goal achievement for each feature (✓/✗)
3. **Weights** - Weight statistics
4. **Includes** - Confirmation includes were applied
5. **Excludes** - Confirmation excludes were applied

---

### Workflow Summary by Sidebar

#### Left Sidebar (Viewing):
```
1. Explore available data
   → Open Map Manager
   → Toggle layers on/off to see what data exists

2. Export results
   → Open Export pane
   → Download solutions and data
```

#### Right Sidebar (Configuring & Analyzing):
```
1. Configure parameters
   → Open New Solution pane
   → Set goals (Themes panel)
   → Set factors (Weights panel)
   → Toggle includes/excludes on/off (Includes/Excludes panels)
   → Set clustering, budget, etc. (Settings panel)
   → Click "Optimize"

2. Review results
   → Solution Results pane opens automatically
   → Review statistics in tabs
   → Check if goals were met
```

---

### Common Confusion Points Clarified

**Q: I see includes/excludes in the Left Sidebar Map Manager. Isn't that where I configure them?**
- A: No! The Map Manager only shows them visually on the map. To configure them for optimization (turn them on/off), use Right Sidebar → New Solution Pane → Includes/Excludes panels.

**Q: What's the difference between "visible" (left) and "status" (right)?**
- A: 
  - **Visible** (Left sidebar): Is this layer currently shown on the map? (visualization only)
  - **Status** (Right sidebar): Is this layer enabled for optimization? (affects solution generation)
  
**Q: Can I configure optimization parameters from the left sidebar?**
- A: No. Left sidebar is view-only. All optimization configuration happens in Right sidebar → New Solution Pane.

**Q: Where do I see which includes/excludes are currently enabled for optimization?**
- A: Right sidebar → New Solution Pane → Includes panel / Excludes panel. You'll see checkboxes showing on/off status.

### Map Controls
- Zoom in/out controls
- Draw tools for custom areas
- Base map selector (globe icon)
- Full-screen toggle
- Help modal (accessible via button)

---

## 5. Data Types & Map Layers

### Planning Units
- Fundamental spatial unit for analysis (typically raster cells or polygons)
- All data must be summarized by planning unit during data prep
- Can be equal or different areas
- Contains numeric values for each layer

### Themes (Conservation Features)
**Purpose**: Represent conservation values to be protected/represented in solutions

**Characteristics**:
- Each theme contains one or more features
- Features have conservation goals (expressed as proportions, e.g., 0.3 = 30%)
- Values are continuous numeric data with meaningful units (km², km, tonnes, counts)
- Current held amount tracked (proportion already in existing protected areas)

**Data Types**:
- Area data (species ranges, habitat types) - sum area per planning unit
- Distance data (river lengths) - sum distance per planning unit  
- Count data (important sites) - sum counts per planning unit
- Categorical data - convert to binary layers (one-hot encoding)
- Probability data - threshold and convert to binary, or clamp values
- Other continuous data (e.g., carbon sequestration)

**Settings per Feature**:
- `status`: enabled/disabled (boolean)
- `goal`: target proportion to achieve (0-1, e.g., 0.2 = 20%)
- `current`: existing proportion in protected areas (0-1)
- `visible`: show/hide on map
- `hidden`: can never be viewed on map (security/sensitivity)
- `downloadable`: can be downloaded or not

### Weights (Cost/Benefit Modifiers)
**Purpose**: Influence which planning units are selected without setting explicit goals

**Characteristics**:
- Modify the cost or benefit of selecting planning units
- No conservation goals attached
- Factor ranges from -100 to +100
  - Positive factors: favor selecting areas with higher weight values
  - Negative factors: avoid areas with higher weight values
- Can be unitless or have meaningful units

**Common Use Cases**:
- Cost data (acquisition costs, management costs)
- Opportunity costs
- Connectivity/spatial importance
- Ecosystem services
- Cultural values

**Settings per Weight**:
- `status`: enabled/disabled (boolean)
- `factor`: importance factor (-100 to 100)
- `current`: existing proportion in protected areas (0-1)
- `visible`: show/hide on map

### Includes (Lock-In Constraints)
**Purpose**: Force specific planning units to be included in solutions

**Characteristics**:
- Binary values (0 or 1)
- Planning units with value = 1 are locked into solutions
- Can be mandatory (always applied) or optional (toggleable)
- Overlap handling with excludes can be configured

**Common Use Cases**:
- Existing protected areas
- Areas with high stakeholder support
- Critical habitats that must be protected
- Areas with existing conservation commitments

**Settings per Include**:
- `status`: enabled/disabled (boolean)
- `mandatory`: must always be applied
- `visible`: show/hide on map
- `overlap`: handling of include/exclude conflicts (set by system)

### Excludes (Lock-Out Constraints)
**Purpose**: Force specific planning units to be excluded from solutions

**Characteristics**:
- Binary values (0 or 1)
- Planning units with value = 1 are locked out of solutions
- Can be mandatory or optional

**Common Use Cases**:
- Urban areas
- Agricultural lands under intensive use
- Areas with incompatible land uses
- Contaminated sites
- Areas with strong opposition to conservation

**Settings per Exclude**:
- `status`: enabled/disabled (boolean)
- `mandatory`: must always be applied
- `visible`: show/hide on map
- `overlap`: handling of include/exclude conflicts

### Solutions (Generated Outputs)
**Purpose**: Results of optimization showing which planning units to prioritize

**Characteristics**:
- Binary values (0 = not selected, 1 = selected)
- Generated by optimization algorithms
- Can be toggled on/off on map
- Displayed with custom colors chosen by user
- Contains comprehensive performance statistics

**Settings per Solution**:
- `name`: user-defined name
- `visible`: show/hide on map
- `color`: display color
- `downloadable`: can be downloaded or not

---

## 6. Statistics & Metrics

### Solution Statistics (Automatically Calculated)

#### Overall Statistics
1. **Total number of planning units** - count of selected units
2. **Total area** - area in km²
3. **Total perimeter** - perimeter length in km
4. **Total number of reserves** - count of discrete reserves/patches
5. **Smallest reserve size** - area in km²
6. **Average reserve size** - area in km²
7. **Largest reserve size** - area in km²

#### Theme Statistics (Per Feature)
- Theme name
- Feature name
- Status (Enabled/Disabled)
- Total amount (in original units)
- Current amount held (% and units)
- Goal (% and units)
- Solution amount held (% and units)
- Met (Yes/No/NA) - whether goal was achieved

#### Weight Statistics (Per Weight)
- Weight name
- Status (Enabled/Disabled)
- Factor value
- Total amount (in units)
- Current amount held (% and units)
- Solution amount held (% and units)

#### Include Statistics (Per Include)
- Include name
- Status (Enabled/Disabled)
- Total amount (in units)
- Solution amount held (% and units)

#### Exclude Statistics (Per Exclude)
- Exclude name
- Status (Enabled/Disabled)
- Total amount (in units)
- Solution amount excluded (% and units)

### Parameter Settings (Recorded with Solutions)
Parameters used to generate the solution:
- **Spatial clustering** - level of connectivity/compactness
- **Optimality gap** - tolerance for near-optimal solutions (%)
- **Area budget** - maximum allowable area (if specified)
- **Time limit** - maximum optimization time
- Other solver-specific parameters

---

## 7. UI Components & Widgets

### Custom HTML Widgets

#### 1. Map Manager Widget
**Purpose**: Layer control and visualization management

**Features**:
- Hierarchical layer list
- Drag-and-drop reordering
- Visibility toggles
- Legend display for each layer
- Layer type icons (theme/weight/include/exclude/solution)
- Provenance information (data source metadata)

**Data Structure**:
```javascript
{
  id: "unique_id",
  name: "Layer Name",
  visible: true/false,
  hidden: true/false,
  legend: { colors, values, labels },
  units: "km²",
  type: "theme" | "weight" | "include" | "exclude" | "solution",
  provenance: { source, date, description }
}
```

#### 2. Solution Settings Widget
**Purpose**: Configure parameters for generating new solutions

**Panels**:
- **Themes**: Sliders for goals, enable/disable toggles
- **Weights**: Sliders for factors (-100 to 100), enable/disable toggles
- **Includes**: Enable/disable toggles
- **Excludes**: Enable/disable toggles
- **Parameters**: Settings for optimization process

**Per Feature Controls**:
- Status toggle (on/off)
- Goal/Factor slider
- Current value display (read-only)
- Total amount display (read-only)
- Units display

#### 3. Solution Results Widget
**Purpose**: Display comprehensive results after optimization

**Tabs**:
1. **Summary** - Overall statistics and parameters
2. **Themes** - Detailed theme/feature performance
3. **Weights** - Weight statistics
4. **Includes** - Include statistics  
5. **Excludes** - Exclude statistics

**Features**:
- Interactive DataTables with sorting/filtering
- Download buttons for Excel export
- Color-coded goal achievement (✓ met, ✗ not met, • disabled)
- Percentage and absolute value displays

#### 4. Import Settings Widget
**Purpose**: Upload and configure new project data

**Features**:
- File upload controls (spatial data, attributes, boundaries)
- Data validation
- Preview of uploaded data
- Configuration options

### Modal Dialogs

1. **Help Modal**
   - Comprehensive user guide
   - Icon explanations
   - Workflow instructions

2. **Import Modal**
   - Builtin project selection
   - Manual data upload interface
   - Spatial data upload

3. **Create Project Modal**
   - New project creation wizard

4. **Solution Results Modal**
   - Detailed results display
   - Tabbed interface for different result types

### Sidebar Panes (Detailed)

All sidebar panes are implemented as Shiny modules with:
- Reactive inputs/outputs
- Custom HTML structure
- Icon-based navigation
- Collapsible/expandable sections

---

## 8. Optimization Approach

### Problem Formulation

The tool solves two types of conservation planning problems:

#### 1. Minimum Set Problem (No Budget)
**Objective**: Minimize total cost while meeting all conservation goals

**Formulation**:
- Minimize: Sum of planning unit costs
- Subject to: 
  - All theme goals are met (or exceeded)
  - Include constraints (lock-in)
  - Exclude constraints (lock-out)
  - Binary decisions (select or not select)

**When Used**: When no area budget is specified

#### 2. Minimum Shortfall Problem (With Budget)
**Objective**: Maximize conservation goal achievement within budget

**Formulation**:
- Maximize: Feature representation
- Subject to:
  - Total cost ≤ budget
  - Include constraints (lock-in)
  - Exclude constraints (lock-out)
  - Binary decisions (select or not select)

**When Used**: When area budget is specified

### Two-Stage Optimization Process

#### Stage 1: Initial Solution
- **Primary Objective**: 
  - No budget: minimize cost while meeting goals
  - With budget: maximize goal achievement
- **Optimality Gap**: 10%
- **Purpose**: Find good initial solution quickly

#### Stage 2: Refinement (if spatial clustering enabled)
- **Primary Objective**: Match Stage 1 objectives
- **Secondary Objective**: Minimize spatial fragmentation
- **Method**: Add connectivity penalties using boundary matrix
- **Optimality Gap**: 15%
- **Purpose**: Create more compact, connected reserves

### Solver Options

#### Gurobi (Commercial)
- Superior performance
- Faster solve times
- Better for large problems
- Requires license (free for academic use)
- Multiple algorithms: branch & bound, barrier, simplex

#### CBC (Open Source)
- Freely available
- Good for small-medium problems
- Slower than Gurobi
- May struggle with very large problems

### Key Optimization Parameters

1. **Optimality Gap** - Tolerance for near-optimal solutions (%)
   - 0% = strictly optimal (may take very long)
   - 10-15% = near-optimal (much faster)

2. **Time Limit** - Maximum solve time
   - Stage 1: Configurable
   - Stage 2: Configurable
   - Prevents indefinite optimization

3. **Spatial Clustering** - Level of connectivity/compactness
   - Uses boundary length matrix
   - Penalty factor controls strength
   - Higher values = more compact solutions

4. **Area Budget** - Maximum allowable area (when specified)

5. **Start Solution** - Warm start from previous solution
   - Speeds up optimization
   - Uses Stage 1 solution for Stage 2

### Optimization Workflow

```
1. User configures parameters in New Solution Pane
   ↓
2. System formulates optimization problem
   - Extracts theme data, goals
   - Applies weights (modify costs)
   - Applies includes (lock-in constraints)
   - Applies excludes (lock-out constraints)
   ↓
3. Stage 1: Initial optimization
   - Minimize cost OR maximize representation
   - 10% gap, time limit
   ↓
4. Stage 2 (if clustering enabled): Refinement
   - Add connectivity penalties
   - 15% gap, time limit
   ↓
5. Calculate comprehensive statistics
   - Overall metrics (area, perimeter, reserves)
   - Theme performance (goals met?)
   - Weight statistics
   - Include/exclude statistics
   ↓
6. Create Solution object with results
   ↓
7. Display in Solution Results Pane
   ↓
8. Add solution layer to map
```

---

## 9. Data Model (R6 Classes)

The application uses R6 classes to organize data. All classes support:
- Cloning (deep/shallow copies)
- Settings export/import
- Widget data generation
- Map rendering

### Core Classes

#### Dataset
**Purpose**: Manages all spatial data for a project

**Key Fields**:
- `spatial_path`: path to spatial data file (raster/vector)
- `attribute_path`: path to attribute data (CSV)
- `boundary_path`: path to boundary matrix (CSV)

**Key Methods**:
- `get_planning_unit_indices()`: get valid planning units
- `get_planning_unit_areas()`: get areas
- `get_boundary_data()`: get boundary/connectivity matrix
- `get_data()`: retrieve spatial data
- `add_index()`: add new data column

#### Variable
**Purpose**: Represents a single data layer

**Key Fields**:
- `dataset`: reference to Dataset object
- `index`: column name in dataset
- `units`: measurement units (e.g., "km²", "tonnes")
- `total`: sum of all values
- `legend`: Legend object for visualization
- `provenance`: metadata about data source

**Key Methods**:
- `render()`: add layer to Leaflet map
- `update_render()`: update existing map layer
- `get_data()`: retrieve values
- `export()`: export settings

#### Feature
**Purpose**: A single conservation feature within a theme

**Key Fields**:
- `id`: unique identifier
- `name`: display name
- `variable`: Variable object with data
- `pane`: map pane identifier
- `status`: enabled/disabled
- `visible`: show on map
- `loaded`: loaded in browser
- `hidden`: cannot be displayed (security)
- `downloadable`: can be downloaded
- `current`: existing protection level (0-1)
- `goal`: target protection level (0-1)
- `min_goal`, `max_goal`, `step_goal`: goal constraints
- `limit_goal`: minimum allowable goal

**Key Methods**:
- `get_*()` and `set_*()`: getters/setters for all fields
- `export()`: export settings

#### Theme
**Purpose**: Group of related features with common units

**Key Fields**:
- `id`: unique identifier
- `name`: theme name (e.g., "Species", "Ecosystems")
- `feature`: list of Feature objects
- `feature_order`: display order on map

**Constraints**:
- All features in a theme must have the same units

**Key Methods**:
- `get_feature_*()`: aggregate feature properties
- `set_feature_*()`: bulk update features
- `get_solution_settings_widget_data()`: data for settings UI
- `get_map_manager_widget_data()`: data for map manager UI
- `render_on_map()`: add to map
- `update_on_map()`: update on map

#### Weight
**Purpose**: Spatial cost or benefit modifier

**Key Fields**:
- `id`: unique identifier
- `name`: display name
- `variable`: Variable object with data
- `status`: enabled/disabled
- `visible`, `hidden`, `downloadable`: visibility settings
- `current`: existing value (0-1)
- `factor`: importance factor (-100 to 100)
- `min_factor`, `max_factor`, `step_factor`: factor constraints

**Key Methods**:
- `get_*()` and `set_*()`: getters/setters
- `get_solution_settings_widget_data()`: settings UI data
- `render_on_map()`: add to map

#### Include
**Purpose**: Areas to lock into solutions

**Key Fields**:
- `id`: unique identifier
- `name`: display name
- `variable`: Variable object (binary data)
- `mandatory`: must always be applied
- `status`: enabled/disabled
- `visible`, `hidden`, `downloadable`: visibility settings
- `overlap`: handling of include/exclude conflicts

**Key Methods**:
- `get_*()` and `set_*()`: getters/setters
- `get_solution_settings_widget_data()`: settings UI data

#### Exclude
**Purpose**: Areas to lock out of solutions

**Key Fields**: (Same structure as Include)
- `id`: unique identifier
- `name`: display name
- `variable`: Variable object (binary data)
- `mandatory`: must always be applied
- `status`: enabled/disabled
- `visible`, `hidden`, `downloadable`: visibility settings
- `overlap`: handling of include/exclude conflicts

**Key Methods**: (Same as Include)

#### Parameter
**Purpose**: Optimization configuration setting

**Key Fields**:
- `id`: unique identifier
- `name`: parameter name (e.g., "Spatial clustering")
- `status`: enabled/disabled
- `value`: current value
- `min_value`, `max_value`, `step_value`: value constraints
- `units`: measurement units
- `reference_value`, `reference_units`: for relative values
- `hide`: hide slider when enabled
- `disable`: disable control
- `tool_tip`: help text

**Common Parameters**:
- Spatial clustering (0-100)
- Optimality gap (0-100%)
- Area budget (varies by project)

**Key Methods**:
- `get_setting()`, `set_setting()`: value management
- `get_widget_data()`: UI configuration
- `get_results_data()`: for results display

#### Statistic
**Purpose**: Calculated metric about a solution

**Key Fields**:
- `name`: statistic name
- `value`: numeric value
- `units`: measurement units
- `proportion`: relative value (optional)

**Examples**:
- Total area: 1250 km² (0.15 or 15%)
- Number of reserves: 12
- Average reserve size: 104.2 km²

**Key Methods**:
- `repr()`: formatted string representation
- `get_widget_data()`: for display
- `get_results_data()`: for tables

#### Result
**Purpose**: Raw optimization results before creating Solution

**Key Fields**:
- `values`: binary vector (0/1 for each planning unit)
- `area`: total selected area
- `perimeter`: total perimeter length
- `theme_coverage`: coverage for each feature
- `weight_coverage`: coverage for each weight
- `include_coverage`: coverage for each include
- `exclude_coverage`: coverage for each exclude
- `theme_settings`, `weight_settings`, etc.: applied settings
- `parameters`: optimization parameters used

**Key Methods**:
- Used internally to construct Solution objects

#### Solution
**Purpose**: Complete solution with all results and metadata

**Key Fields**:
- `id`: unique identifier
- `name`: solution name
- `variable`: Variable object with binary solution data
- `visible`, `loaded`, `hidden`, `downloadable`: display settings
- `parameters`: list of Parameter objects
- `statistics`: list of Statistic objects
- `theme_results`: list of ThemeResults objects
- `weight_results`: list of WeightResults objects
- `include_results`: list of IncludeResults objects
- `exclude_results`: list of ExcludeResults objects

**Key Methods**:
- `get_summary_results_data()`: overall statistics table
- `get_theme_results_data()`: theme performance table
- `get_weight_results_data()`: weight statistics table
- `get_include_results_data()`: include statistics table
- `get_exclude_results_data()`: exclude statistics table
- `render_*_results()`: create DataTables for display
- `get_solution_results_widget_data()`: results UI data
- `render_on_map()`: add to map

#### FeatureResults, ThemeResults, WeightResults, IncludeResults, ExcludeResults
**Purpose**: Store performance data for each component type

**Common Structure**:
- Reference to original object (Feature/Theme/Weight/etc.)
- `held`: proportion achieved in solution (0-1)
- Methods for extracting results data

**ThemeResults Additional**:
- Contains list of FeatureResults (one per feature)
- Aggregates feature-level results

#### SolutionSettings
**Purpose**: Complete configuration for optimization

**Key Fields**:
- `themes`: list of Theme objects
- `weights`: list of Weight objects
- `includes`: list of Include objects
- `excludes`: list of Exclude objects
- `parameters`: list of Parameter objects

**Key Methods**:
- `get_theme_data()`: extract theme matrix
- `get_weight_data()`: extract weight matrix
- `get_include_data()`: extract include matrix
- `get_exclude_data()`: extract exclude matrix
- `get_theme_settings()`: current theme settings
- `get_weight_settings()`: current weight settings
- etc.

#### Legend Classes
**Purpose**: Define visualization for map layers

**Types**:
1. **ContinuousLegend** - continuous color ramps
   - `colors`: color palette
   - `values`: min/max values
2. **CategoricalLegend** - discrete categories
   - `colors`: color per category
   - `values`: category values
   - `labels`: category names
3. **ManualLegend** - custom defined
   - `colors`, `values`, `labels`: manually specified
4. **NullLegend** - no legend (hidden layers)

### Class Hierarchy

```
Dataset (manages spatial data)
  └─> Variable (single data layer)
       ├─> Legend (visualization)
       └─> Provenance (metadata)

Feature (single conservation target)
  └─> Variable

Theme (group of features)
  └─> list of Feature objects

Weight (cost/benefit modifier)
  └─> Variable

Include (lock-in constraint)
  └─> Variable

Exclude (lock-out constraint)
  └─> Variable

SolutionSettings (optimization config)
  ├─> list of Theme objects
  ├─> list of Weight objects
  ├─> list of Include objects
  ├─> list of Exclude objects
  └─> list of Parameter objects

Result (raw optimization output)
  └─> numeric vectors & matrices

Solution (complete results package)
  ├─> Variable (solution data)
  ├─> list of Statistic objects
  ├─> list of ThemeResults objects
  ├─> list of WeightResults objects
  ├─> list of IncludeResults objects
  └─> list of ExcludeResults objects

ThemeResults
  └─> list of FeatureResults objects

FeatureResults, WeightResults, IncludeResults, ExcludeResults
  └─> held proportion (0-1)
```

---

## 10. Detailed Technical Workflows

### Data Import Workflow
1. User uploads or selects builtin project
2. System validates spatial data, attributes, boundaries
3. Creates Dataset object
4. Creates Variable objects for each attribute column
5. Creates Theme/Weight/Include/Exclude objects
6. Initializes Solution Settings
7. Renders initial map view

### Solution Generation Workflow
1. User configures themes (goals), weights (factors), includes/excludes (on/off)
2. User sets parameters (clustering, budget, etc.)
3. User names solution and selects color
4. Click "Optimize"
5. System creates SolutionSettings from current state
6. System formulates optimization problem
7. Stage 1: Initial solve (10% gap)
8. Stage 2: Refinement with clustering (15% gap, if enabled)
9. Calculate statistics
10. Create Result object
11. Create Solution object from Result
12. Store solution in Dataset
13. Open Solution Results Pane
14. Add solution layer to map

### Results Exploration Workflow
1. View solution on map (toggle visibility)
2. Switch between result tabs (Summary/Themes/Weights/Includes/Excludes)
3. Sort and filter tables
4. Check goal achievement (✓/✗ indicators)
5. Download results as Excel spreadsheet
6. Download solution as spatial data (raster/vector)
7. Generate additional solutions for comparison

---

## 11. Data Preparation Requirements

### Input Data Format

The tool uses a 4-file format:

1. **Spatial File** (.tif raster or .shp/.gpkg vector)
   - Defines planning unit geometry
   - Each pixel/polygon = one planning unit

2. **Attribute File** (.csv)
   - Rows = planning units (matches spatial file)
   - Columns = data layers (themes, weights, includes, excludes, cost)
   - Numeric values summarized per planning unit

3. **Boundary File** (.csv)
   - Sparse matrix format (id1, id2, boundary_length)
   - Defines connectivity between planning units
   - Used for spatial clustering

4. **Configuration File** (.yaml, optional)
   - Metadata for each layer
   - Layer types (theme/weight/include/exclude)
   - Units, provenance, visualization settings
   - Default goals, factors, etc.

### Data Prep Guidelines

**Themes**:
- Use continuous values with meaningful units
- Sum area/distance/count per planning unit
- For categorical data: one-hot encode to binary themes
- For probability data: threshold to binary or clamp low values

**Weights**:
- Can be continuous or unitless
- Sum values (especially for different-sized planning units)
- Mean values acceptable for equal-sized units

**Includes/Excludes**:
- Must be binary (0 or 1)
- Use area threshold (commonly 50%) to determine inclusion
- 1 = lock in/out, 0 = no constraint

**General**:
- All data must align with planning unit geometry
- Missing values handled as 0 or NA
- Large values may need scaling for numerical stability

---

## 12. Current Limitations & Constraints

### Technical Limitations
1. **Browser Requirements**: Google Chrome recommended/required
2. **Solver Availability**: 
   - CBC (open source) slower for large problems
   - Gurobi (commercial) requires license
3. **Problem Size**: Very large datasets may exceed memory or time limits
4. **Non-linear Objectives**: Cannot handle complex non-linear connectivity metrics

### Data Constraints
1. **Planning Units**: All data must be summarized to same planning unit grid
2. **Theme Units**: All features in a theme must share same units
3. **Binary Constraints**: Includes/excludes must be binary
4. **Complete Coverage**: Planning units should cover entire study area

### Workflow Constraints
1. **Single Project**: Only one project loaded at a time
2. **Sequential Optimization**: Cannot run multiple optimizations simultaneously
3. **Memory**: All data loaded into browser memory during session
4. **Persistence**: Solutions not automatically saved (must download)

---

## 13. Future Considerations

Based on current architecture, potential extensions could include:

### Data & Analysis
- Multiple objective optimization
- Uncertainty analysis
- Scenario comparison tools
- Time-series/dynamic planning
- Climate change projections
- Connectivity algorithms beyond boundary matrix

### UI/UX
- Solution comparison view (side-by-side)
- Interactive what-if scenarios
- Real-time budget constraint visualization
- Mobile-responsive design
- Collaborative features (multi-user)

### Technical
- Backend processing (move optimization off browser)
- Solution caching/database storage
- API for programmatic access
- Integration with other GIS tools
- Cloud deployment options

---

## Summary: What We Currently Have

### Data Types (4 Main Categories)
1. **Themes** - conservation features with goals
2. **Weights** - cost/benefit modifiers with factors
3. **Includes** - lock-in constraints
4. **Excludes** - lock-out constraints

### Statistics (3 Main Categories)
1. **Overall Solution Metrics** - area, perimeter, reserve count/sizes
2. **Performance Metrics** - goal achievement, feature representation
3. **Parameter Values** - optimization settings used

### UI Components (6 Main Categories)
1. **Sidebars** - left (4 panes) and right (2 panes)
2. **Map** - interactive Leaflet display
3. **Widgets** - MapManager, SolutionSettings, SolutionResults, ImportSettings
4. **Modals** - Help, Import, CreateProject, SolutionResults
5. **Tables** - interactive DataTables with export
6. **Controls** - sliders, toggles, buttons, color pickers

### Optimization
- **Algorithms**: Exact solvers (Gurobi, CBC)
- **Problems**: Minimum Set, Minimum Shortfall
- **Approach**: Two-stage optimization (initial + refinement)
- **Features**: Goal-based, spatial clustering, budget constraints

### Data Model
- **7 Core Classes**: Dataset, Variable, Feature, Theme, Weight, Include, Exclude
- **5 Results Classes**: Solution, ThemeResults, FeatureResults, WeightResults, IncludeResults, ExcludeResults
- **4 Support Classes**: Parameter, Statistic, SolutionSettings, Result
- **4 Legend Classes**: Continuous, Categorical, Manual, Null

---

*Document created: November 2025*
*For: Where To Work application redesign project*

---

## Appendix A: Complete Glossary of Terms

*This comprehensive glossary defines all technical terms, settings, and concepts used in the Where To Work application. For a quick reference of key concepts, see Section 2.*

### Core Concepts

**Conservation Planning**
- The systematic process of identifying and prioritizing areas for conservation to achieve biodiversity and ecosystem objectives while minimizing costs and conflicts.

**Optimization**
- A mathematical process that finds the best solution (optimal or near-optimal) to a problem by evaluating many possible combinations and selecting the one that best meets specified objectives and constraints.

**Planning Unit**
- The fundamental spatial unit of analysis; typically a grid cell (raster) or polygon (vector). The tool selects planning units to include in conservation solutions. All data values are aggregated/summarized to planning units.

**Study Area**
- The geographic region being analyzed, divided into planning units. Contains all the data layers needed for conservation planning.

### Data Layer Types

**Theme**
- A conservation feature or group of features representing biodiversity values you want to protect (e.g., species habitats, ecosystem types). Each theme has one or more features with explicit **goals** (target percentages to protect). Also called "conservation targets" or "conservation features."

**Feature**
- A single conservation element within a theme (e.g., "Grizzly Bear Habitat" within "Species" theme). Each feature has its own protection goal.

**Weight**
- A data layer that influences which planning units are preferred or avoided, without setting explicit goals. Weights modify the cost or benefit of selecting planning units based on factors like acquisition cost, connectivity, or ecosystem services. Controlled by a **factor** value (-100 to +100).

**Include**
- A constraint layer that forces specific planning units to be included (locked-in) to the solution. Binary layer (0 or 1) where 1 = must be selected. Used for existing protected areas, critical habitats, or stakeholder priorities.

**Exclude**
- A constraint layer that forces specific planning units to be excluded (locked-out) from the solution. Binary layer (0 or 1) where 1 = cannot be selected. Used for urban areas, incompatible land uses, or unavailable areas.

**Solution**
- The output of an optimization run; a spatial pattern showing which planning units should be prioritized for conservation (selected = 1, not selected = 0). Also called a "conservation plan" or "prioritization scenario."

### Settings & Parameters

This section describes configuration options organized by what they apply to.

#### Feature Settings (apply to conservation features within Themes)

**Goal**
- The target amount of a conservation feature to protect, expressed as a proportion (0-1) or percentage (0-100%). Example: 0.30 = 30% goal. The optimization attempts to meet or exceed all feature goals.
- **Used by**: Features (within Themes)

**Current**
- The proportion of a feature's or weight's total that is already protected in existing conservation areas (0-1 or 0-100%). Shown as a baseline when evaluating goals.
- **Used by**: Features and Weights

**Status**
- Whether a data layer is enabled (ON) or disabled (OFF) for the optimization. Disabled layers are ignored.
- **Used by**: All data layers (Themes/Features, Weights, Includes, Excludes)

#### Weight Settings (apply to Weights only)

**Factor**
- The importance/influence value assigned to a weight, ranging from -100 to +100:
  - **Negative factors** (e.g., -75): Avoid areas with high values (e.g., avoid expensive areas)
  - **Positive factors** (e.g., +60): Prefer areas with high values (e.g., prefer well-connected areas)
  - **Zero**: Weight has no effect
- **Used by**: Weights only

#### Include/Exclude Settings

**Mandatory**
- A property indicating whether the constraint must always be applied (true) or can be toggled on/off (false).
- **Used by**: Includes and Excludes only

#### Display Settings (apply to all data layers)

**Visible**
- Whether a data layer is currently displayed on the map. Can be toggled via the eye icon in the Map Manager.
- **Used by**: All data layers and Solutions

**Hidden**
- A property indicating that a layer can never be displayed on the map (for security/sensitivity reasons). If true, the layer exists in the data but cannot be visualized.
- **Used by**: All data layers and Solutions

**Downloadable**
- Whether a data layer or solution can be exported/downloaded by users.
- **Used by**: All data layers and Solutions

**Loaded**
- Whether a layer's data has been loaded into the browser's memory for display on the map (internal state management).
- **Used by**: All data layers and Solutions (internal/technical)

#### Global Optimization Parameters (apply to the entire optimization problem)

**Budget** (or Area Budget)
- A constraint on the maximum total area that can be selected in a solution. If specified, the tool uses "Minimum Shortfall" mode to maximize goal achievement within the budget. If not specified, the tool uses "Minimum Set" mode to minimize area while meeting all goals.
- **Applies to**: The entire optimization problem

**Spatial Clustering**
- A parameter (0-100) that controls how compact and connected the solution should be. Higher values produce fewer, larger patches; lower values allow more scattered selections.
- **Applies to**: The entire optimization problem (Stage 2)

**Optimality Gap**
- A tolerance parameter (0-100%) that determines how close to the optimal solution the algorithm must be before it's allowed to stop. Once the solution reaches this threshold, the algorithm stops immediately (it does not continue searching for improvements).
  - 0% = strictly optimal - algorithm must find the absolute best solution (may take very long)
  - 10-15% = near-optimal - algorithm stops when solution is within 10-15% of optimal (much faster, typical default)
  - Higher % = algorithm can stop sooner with a potentially lower quality solution (faster)
- **Example**: With a 10% gap, if the theoretical optimal solution has a cost of 100, the algorithm will stop as soon as it finds a solution with cost ≤ 110.
- **Applies to**: The entire optimization problem

### Optimization Terms

**Exact Algorithm**
- A class of algorithms that guarantee optimality or near-optimality within a specified gap. Examples include branch-and-bound, simplex, and interior point methods.

**Solver**
- The optimization software engine that solves the mathematical problem. The tool uses either Gurobi (commercial) or CBC (open-source).

**Minimum Set Problem**
- An optimization formulation that minimizes the total area (or cost) selected while meeting all conservation goals. Used when no budget is specified.

**Minimum Shortfall Problem**
- An optimization formulation that maximizes goal achievement within a fixed budget constraint. Used when an area budget is specified.

**Two-Stage Optimization**
- The tool's approach of running optimization in two phases:
  1. **Stage 1**: Optimize for goals/cost (10% gap)
  2. **Stage 2**: Refine for spatial clustering/connectivity (15% gap, if enabled)

**Constraint**
- A requirement that must be satisfied in the solution (e.g., meet feature goals, respect budget, lock-in includes, lock-out excludes).

**Objective Function**
- The mathematical expression being optimized (minimized or maximized). Examples: minimize cost, maximize feature representation, minimize fragmentation.

**Feasible Solution**
- A solution that satisfies all constraints (goals, budget, includes, excludes).

**Incumbent Solution**
- The best feasible solution found so far during optimization.

**Connectivity Penalty**
- A term added to the objective function (in Stage 2) to encouraging spatial clustering, which penalizes boundary length between selected and unselected units.

### Project Structure

**Project**
- A complete dataset for a study area, including:
  - Spatial data (planning unit geometry)
  - Attribute data (values for all planning units)
  - Boundary data (connectivity between units)
  - Configuration (metadata, layer definitions)

**Dataset (Class)**
- An R6 object that manages all spatial data for a project, including methods to access planning units, boundaries, and attribute values.

**Variable (Class)**
- An R6 object representing a single data layer (one column from attribute data) with associated metadata (units, legend, provenance).

**Legend**
- Visualization settings for displaying a layer on the map (colors, value ranges, labels). Types: Continuous, Categorical, Manual, Null.

**Provenance**
- Metadata about a data layer's source, creation date, processing steps, and quality information.

### UI Components

**Sidebar**
- Collapsible panel on left or right side of the map containing panes:
  - **Left sidebar**: Data visualization tools (Map Manager, Export, Contact, Acknowledgments)
  - **Right sidebar**: Analysis tools (New Solution, Solution Results)

**Pane**
- A tab/panel within a sidebar, accessed by clicking an icon. Each pane serves a specific purpose.

**Widget**
- A custom interactive HTML component. Examples: MapManager widget, SolutionSettings widget, SolutionResults widget, ImportSettings widget.

**Modal**
- A popup dialog box that appears over the main interface for specific tasks (e.g., Help, Import, Solution Results).

**Map Manager**
- The left sidebar pane showing an interactive table of contents for all data layers and solutions, with visibility toggles and reordering.

**New Solution Pane**
- The right sidebar pane where users configure themes, weights, includes, excludes, and parameters before generating a solution.

**Solution Results Pane**
- The right sidebar pane displaying detailed performance statistics and tables after a solution is generated.

**DataTable**
- An interactive table component (using DT R package) with sorting, filtering, and export capabilities. Used extensively in Solution Results.

### Statistics & Results

**Total Area**
- The sum of areas of all selected planning units in a solution, typically reported in km².

**Total Perimeter**
- The total length of boundaries between selected and unselected planning units, typically reported in km. Used to measure compactness.

**Number of Reserves**
- Count of discrete, contiguous patches of selected planning units in a solution. Fewer reserves typically indicate more consolidated solutions.

**Reserve Size**
- Area statistics for individual patches: smallest, average, and largest reserve sizes.

**Goal Achievement**
- Whether a feature's goal was met in the solution:
  - **Met (✅)**: Solution amount ≥ goal amount
  - **Not Met (❌)**: Solution amount < goal amount
  - **N/A**: Feature was disabled

**Held** (or Coverage)
- The proportion (0-1) or percentage (0-100%) of a feature's total that is included in the solution.

**Shortfall**
- The gap between a feature's goal and what was achieved: Goal - Held. Positive shortfall = goal not met.

**Theme Results**
- Performance statistics for each feature within each theme, showing whether goals were achieved.

**Weight Results**
- Statistics showing how much of each weight's values were captured in the solution.

**Include/Exclude Results**
- Confirmation that include/exclude constraints were properly applied (should be 100% and 0% respectively when enabled).

**Parameter Results**
- A record of all settings used to generate a solution (for reproducibility and comparison).

### File Formats

**Spatial File**
- Raster (e.g., .tif) or vector (e.g., .shp, .gpkg) file defining planning unit geometry.

**Attribute File**
- CSV file with rows = planning units and columns = data layer values.

**Boundary File**
- Sparse matrix CSV file (id1, id2, boundary_length) defining adjacency/connectivity between planning units.

**Configuration File**
- YAML file with metadata, layer definitions, and default settings for a project.

**Results Spreadsheet**
- Excel workbook (.xlsx) containing all solution statistics and performance tables, exported from Solution Results pane.

### Technical Terms

**R6 Class**
- A way of organizing code in R using object-oriented programming. Think of it like a template or blueprint for creating objects that have both data (fields) and behaviors (methods). For example, a "Theme" R6 class defines what data a theme contains (name, features, goals) and what it can do (render on map, export settings). All major data types in this tool (Theme, Weight, Solution, etc.) are R6 classes. This is a technical implementation detail - users don't interact with R6 directly.

**Shiny**
- An R framework for building interactive web applications. The tool's UI is built with Shiny.

**Golem**
- An R package framework for developing production-grade Shiny applications. Organizes code into modules and provides deployment tools.

**Leaflet**
- A JavaScript library for interactive maps. The tool uses leaflet.js (via the R leaflet package) for map visualization.

**HTMLWidget**
- A framework for creating custom interactive JavaScript visualizations that work within R/Shiny. Used for MapManager, SolutionSettings, and SolutionResults.

**Prioritizr**
- An R package for systematic conservation planning that interfaces with optimization solvers. The tool uses prioritizr to formulate and solve conservation problems.

**Gurobi**
- A commercial mathematical optimization solver known for high performance. Free for academic use, requires license for commercial use.

**CBC (Coin-or Branch and Cut)**
- An open-source mathematical optimization solver. Slower than Gurobi but freely available.

**Reactive**
- Shiny's programming model where UI changes automatically trigger server-side recalculations and UI updates.

**Planning Unit Index**
- A unique identifier (typically integer) for each planning unit in the dataset.

**Boundary Matrix**
- A sparse matrix representing adjacency and shared boundary length between planning units. Used for spatial clustering calculations.

**Binary Variable**
- A decision variable in optimization that can only be 0 or 1 (not selected / selected). All planning unit selection decisions are binary.

**Continuous Variable**
- A decision variable that can take any value within a range (not used for planning unit decisions, but appears in relaxed optimization problems).

**Mixed Integer Programming (MIP)**
- A class of optimization problems containing both integer (or binary) and continuous variables. Conservation planning problems are typically MIP problems.

