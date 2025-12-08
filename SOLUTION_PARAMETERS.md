# Solution Parameters Inventory
*Comprehensive Catalog of Search Inputs for the Solution Finder UI*

This document outlines the inputs available for the conservation planning optimization. 

> **Dynamic Nature of Parameters:** The lists below represent a **starting point** based on current datasets (`costs_and_constraints 4_24_corrida_nacional_18112025.xlsx`, `features_v4_4_24_corrida_nacional_18112025.xlsx`). As the project evolves, the number of features (themes) may grow into the thousands. Therefore, this document also outlines strategies for grouping and organizing these parameters to maintain a usable interface.

---

# Section I: Current Inventory (Features, Weights, Includes, Excludes)

This section lists the specific layers currently identified for the initial deployment.

## 1. Themes (Conservation Goals)
*UI Component: Continuous Sliders or Selection List*
*Core conservation targets where users define a percentage goal (e.g., "Protect 30% of Wetlands").*

| Theme Name (English) | Theme Name (Spanish) | Abbreviation | Category/Source |
| :--- | :--- | :--- | :--- |
| **Ecosystems IAvH** | Ecosistemas IAvH | **Ecos** | General Ecosystems |
| **Strategic Ecosystems** | Ecosistemas Estratégicos | **Ecos estrategicos** | *Aggregated Group* |
| &nbsp;&nbsp;&nbsp;&nbsp;*Moorland / Paramo* | Páramo | | Ecosystems |
| &nbsp;&nbsp;&nbsp;&nbsp;*Mangrove* | Manglar | | Ecosystems |
| &nbsp;&nbsp;&nbsp;&nbsp;*Wetlands* | Humedales | | Ecosystems |
| &nbsp;&nbsp;&nbsp;&nbsp;*Dry Forest* | Bosque seco | | Ecosystems |
| **Species Representation** | Especies (General) | **Sp Rep** | Biodiversity (Broad) |
| **Species Restricted/Threatened**| Especies Endémicas/Amenazadas | **Sp RD** | Biodiversity (High Value) |
| **Ecosystem Services** | Servicios Ecosistémicos | **SE** | *Aggregated Group* |
| &nbsp;&nbsp;&nbsp;&nbsp;*Soil Organic Carbon* | Carbono orgánico en suelos | | Carbon |
| &nbsp;&nbsp;&nbsp;&nbsp;*Biomass* | Biomasa aérea + subterránea | | Carbon |
| &nbsp;&nbsp;&nbsp;&nbsp;*Water Regulation* | Recarga de agua / ENA | | Water |

## 2. Weights (Costs & Conflicts)
*UI Component: Sliders or Toggles (Avoid/Prioritize)*
*Layers that influence the "cost" of selecting a planning unit, prioritizing low-cost/low-conflict areas.*

| Weight Name | Original Layer Name | Abbreviation | Category | Description |
| :--- | :--- | :--- | :--- | :--- |
| **Opportunity Cost** | `Beneficio_neto` / `Costo_oportunidad` | | Cost | Net benefit / Opportunity cost analysis. |
| **Human Footprint** | `Huella_Humana` / `IHEH_2022` | **IHEH** | Cost | Human pressure index (Cost layer for standard scenarios). |
| **Agricultural Rent** | `Renta_Agropecuaria` | | Cost | Economic rent from agricultural activities. |
| **Conflict (2016-2022)** | `Conflicto_2016_2022` | | Cost | Coca crops and violent deaths data. |

## 3. Includes (Lock-In Constraints)
*UI Component: Toggles / Grouped Checkboxes*
*Areas that MUST be included in the solution.*

| Include Name | Original Layer | Abbreviation | Notes |
| :--- | :--- | :--- | :--- |
| **Protected Areas (RUNAP)** | `RUNAP` layers | **RUNAP** | Locked in for all standard scenarios. |
| **RAMSAR Sites** | `Sitios_RAMSAR` | | |
| **Indigenous Reserves** | `Resguardos_Indígenas` | | |
| **Forest Reserves (Law 2nd)** | `Reservas_de_ley_2da` | | |
| **SIRAP** | `SIRAP` layers | | Regional protected areas. |
| **OMECs** | `OMECs` | | |

## 4. Excludes (Lock-Out Constraints)
*UI Component: Toggles*
*Areas that MUST NOT be included in the solution.*

*   **Current Status:** No specific exclude layers are listed in the initial dataset.
*   **Future Capabilities:** The system is designed to handle Excludes. Common candidates include:
    *   Urban Centers
    *   Major Infrastructure (Roads, Dams)
    *   Active Mining/Oil Concessions

---

# Section II: Examples and Strategies

As the data volume grows, we need strategies to manage complexity for the user.

## 1. Grouping Strategy (Handling Thousands of Layers)
To prevent user overwhelm, layers will be organized hierarchically. The interface should adapt based on user proficiency.

### Hierarchy Levels
1.  **Super-Groups (Domains):** Top-level categories (e.g., "Biodiversity", "Water", "Carbon").
2.  **Sub-Groups (Functional):** (e.g., "Birds", "Mammals" under Biodiversity; "Headwaters", "Recharge Zones" under Water).
3.  **Individual Layers (Features):** The specific raster data (e.g., "Andean Bear Habitat").

### User Proficiency Modes
*   **Basic Mode:** Users interact only with **Super-Groups**. Enabling "Biodiversity" implicitly selects representative features or an aggregate index.
*   **Advanced Mode:** Users can expand groups to toggle **Individual Layers** or define custom weights for specific sub-layers (e.g., "I care about Birds more than Mammals").

## 2. Example Scenarios (Pending Validation)
*Draft scenarios illustrating how parameters can be mixed.*

> **⚠️ DISCLAIMER:** These scenarios are derived from draft discussions and must be verified by the team. They serve as structural examples of "Preset" configurations.

These examples assume:
*   **Lock-in:** Always `RUNAP`
*   **Cost:** Always `IHEH` (Human Footprint)

| ID | Description | Ecos (General) | Ecos Strategic | Sp Rep (Bio) | Sp RD (Endemic) | SE (Services) |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **1** | **Baseline Protection** | **17%** | 0% | 0% | 0% | 0% |
| **2** | **High Baseline** | **34%** | 0% | 0% | 0% | 0% |
| **3** | **Strategic Mix A** | **17%** | **17%** | 0% | 0% | 0% |
| **4** | **Strategic Mix B** | **17%** | **34%** | 0% | 0% | 0% |
| **5** | **High Ambition A** | **34%** | **17%** | 0% | 0% | 0% |
| **6** | **High Ambition B** | **34%** | **34%** | 0% | 0% | 0% |
