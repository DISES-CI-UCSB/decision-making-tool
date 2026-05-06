# Cargar librerías necesarias
library(raster)
library(doParallel)
library(openxlsx)
library(fst)
library(dplyr)

# Directorio de trabajo
setwd("C:/Clouds/Box/Proyectos_JBG/mesa_prioridades/Cambio_Global")
extension="EJE_CAFETERO"
resolution="1km"

# Cargar archivos y definición de parámetros necesarios
scenarios=read.xlsx("./input/Propuesta_Ejecafero_26625.xlsx","escenarios_nuevos")
#scenarios=scenarios[scenarios$SIRAP == extension,]
pus=raster(paste0("C:/Clouds/Box/Proyectos_JBG/mesa_prioridades/PUs/PUS_",extension,"_",resolution,".tif"))
pu_ids=read.csv(paste0("./input/PUs_",extension,"_",resolution,".csv"))
costs_and_constraints=read.xlsx("./input/costs_and_constraints_v3_05_24.xlsx")
gc(reset = T)

# Priorización
#n_cores=ifelse(detectCores()<nrow(scenarios),detectCores(),nrow(scenarios))
n_cores=8
cl=makeCluster(n_cores,type="PSOCK")
registerDoParallel(cl,cores=n_cores)
foreach(i=1:nrow(scenarios),.verbose=T,.errorhandling="remove",
        .packages=c("prioritizr","gurobi","raster","dplyr","doParallel","fst","openxlsx")) %dopar%{
  unique_features=scenarios$id_elemento_priorizacion[i]
  unique_features=paste(unique_features,collapse=',')
  unique_features=as.numeric(strsplit(unique_features, ",")[[1]])
  target=scenarios$sensibilidad[i]
  target=paste(target,collapse=',')
  target=as.numeric(strsplit(target, ",")[[1]])
  rij=read.fst(paste0("./input/rij_",extension,"_",resolution,".fst"))
  rij=rij %>% filter(pu %in% pu_ids$id)
  features=read.xlsx("./input/features_v4_4_24_(MAPV).xlsx")
  features=features[-which(features$id_original == 0),]
  features=features[features$id_elemento_priorizacion %in% unique_features,]
  features=features %>% filter(id %in% unique(rij$species))
  gc(reset = T, full = T)
  rij=rij %>% filter(species %in% features$id)
  gc(reset = T)
  for (j in 1:length(unique_features)){
    if (target[j] != 0){
      features[features$id_elemento_priorizacion==unique_features[j],"target"]=as.numeric(target[j])/100
    } else{
      features[features$id_elemento_priorizacion==unique_features[j],"target"]=as.numeric(features[features$id_elemento_priorizacion==unique_features[j],"umbral"])/100
    }
  }
  features$target=as.numeric(features$target)
  features=features[,c("id","name","target")]
  features=features %>% group_by(id) %>% slice_max(target, n = 1) %>% ungroup()
  if (costs_and_constraints$cost_relation[costs_and_constraints$name==scenarios$costo[i]]=="directa"){
    pu_ids[,scenarios$costo[i]]=(((pu_ids[,scenarios$costo[i]]-min(pu_ids[,scenarios$costo[i]]))/(max(pu_ids[,scenarios$costo[i]])-min(pu_ids[,scenarios$costo[i]])))*100)+1
  } else{
    pu_ids[,scenarios$costo[i]]=100-(((pu_ids[,scenarios$costo[i]]-min(pu_ids[,scenarios$costo[i]]))/(max(pu_ids[,scenarios$costo[i]])-min(pu_ids[,scenarios$costo[i]])))*100)+1
  }
  gc(reset = T)
  p=problem(x=pu_ids,features=features,rij=rij,cost_column=scenarios$costo[i]) %>%
    add_min_set_objective() %>%
    add_relative_targets("target") %>%
    add_proportion_decisions() %>%
    add_gurobi_solver(gap = 0.1, threads = detectCores(), node_file_start=4)
  gc(reset = T)
  constraints=scenarios$inclusion[i]
  if (!is.na(constraints)){
    constraints=paste(constraints,collapse=',')
    constraints=strsplit(constraints, ",")[[1]]
    rows=c()
    for(j in constraints){
      rows=c(rows,which(!is.na(pu_ids[,j])))
    }
    rows=sort(unique(rows))
    constraints=pu_ids$id[rows]
  }
  if(unique(!is.na(constraints))){
    p=p %>% add_locked_in_constraints(pu_ids$id %in% constraints)
  }
  # constraints=scenarios$exlusion[i]
  # if (!is.na(constraints)){
  #   constraints=paste(constraints,collapse=',')
  #   constraints=strsplit(constraints, ",")[[1]]
  #   rows=c()
  #   for(j in constraints){
  #     rows=c(rows,which(!is.na(pu_ids[,j])))
  #   }
  #   rows=sort(unique(rows))
  #   constraints=pu_ids$id[rows]
  # }
  # if(unique(!is.na(constraints))){
  #   p=p %>% add_locked_out_constraints(pu_ids_i$id %in% constraints)
  # }
  gc(reset = T)
  s=solve(p,run_checks=F)
  names(s)[ncol(s)]="best"
  r=pus*0
  ids=s$id[s$best==1]
  r[pus %in% ids]=1
  writeRaster(r,paste0("./output/",extension,"/",scenarios$escenario[i],".tif"),overwrite=T,options="COMPRESS=DEFLATE",datatype='INT1U',NAflag=0)
  gc(reset = T)
}
stopCluster(cl)
gc(reset = T)
