library(doParallel)
library(openxlsx)
library(sf)
library(dplyr)

extension="Nacional"
resolution="5km"

# DEFINE PUs

PUs_p=read_sf((paste0("C:/Clouds/Box/Proyectos_JBG/mesa_prioridades/PUs/PUs_",extension,"_",resolution,".shp")))

# DELIMIT TO ONLY COSTS AND COSTRAINTS TO BE USED IN SCENARIOS

scenarios=read.xlsx("C:/Clouds/Box/Proyectos_JBG/mesa_prioridades/Cambio_Global/input/scenarios_to_run_v4_4_24_JBG.xlsx")
scenarios=scenarios[scenarios$SIRAP == extension,]
costs=unique(scenarios$costo)
scenarios=c(scenarios$costo,scenarios$inclusion,scenarios$exlusion)
scenarios=paste(scenarios,collapse=',')
scenarios=unique(strsplit(scenarios, ",")[[1]])
scenarios=scenarios[scenarios != "NA"]
costs_and_constraints=read.xlsx("C:/Clouds/Box/Proyectos_JBG/mesa_prioridades/Cambio_Global/input/costs_and_constraints_v3_05_24.xlsx")
costs_and_constraints=costs_and_constraints[costs_and_constraints$name %in% scenarios,]

# SEPARATE CATEGORY AND CONTINUOUS LAYERS
cat_by_layer=as.data.frame(costs_and_constraints %>% group_by(archivo,name) %>% summarise(count=n(),sum=sum(id_original)))
gc(reset = T)

#### ONE CATEGORY LAYERS ####

files=cat_by_layer %>% filter(count==1 & sum==1) %>% select (archivo,name)
n_cores=ifelse(nrow(files)<detectCores(),nrow(files),detectCores())
cl=makeCluster(n_cores,type="PSOCK")
registerDoParallel(cl,cores=n_cores)
costs_and_constraints_1=foreach(i=1:nrow(files),.inorder=T,.verbose=T,.packages=c("raster","exactextractr"),.combine=cbind.data.frame) %dopar%{
  df=raster(files$archivo[i])
  df[df!=1]=NA
  df=exact_extract(df, PUs_p, fun='sum')
  df=df/max(df)
  df=ifelse(df>=0.5,1,NA)
  gc(reset = T)
  return(df)
}  
stopCluster(cl)
gc(reset = T)
if(nrow(files)==1){
  costs_and_constraints_1=cbind.data.frame(costs_and_constraints_1)
}
names(costs_and_constraints_1)=files$name

#### MULTIPLE CATEGORY LAYERS ####

files=cat_by_layer[cat_by_layer$count>1,c("archivo","name")]
n_cores=ifelse(nrow(files)<detectCores(),nrow(files),detectCores())
cl=makeCluster(n_cores,type="PSOCK")
registerDoParallel(cl,cores=n_cores)
costs_and_constraints_2=foreach(i=1:nrow(files),.inorder=T,.verbose=T,.packages=c("raster","exactextractr","dplyr"),.combine=cbind.data.frame) %dopar%{
  df=raster(files$archivo[i])
  df=exact_extract(df, PUs_p, include_cols="Id")
  gc(reset = T)
  df=do.call(rbind.data.frame, df)
  gc(reset = T)
  df=df %>% filter(!is.na(value))
  gc(reset = T)
  df=as.data.frame(df %>% group_by(Id) %>% summarise(amount = sum(coverage_fraction)))
  gc(reset = T)
  df$amount=df$amount/max(df$amount)
  df$amount=ifelse(df$amount>=0.5,1,0)
  df=df[df$amount==1,c("Id","amount")]
  df=base::merge(PUs_p[,"Id"],df, all.x=T)
  df=df$amount
  gc(reset = T)
  return(df)
}  
stopCluster(cl)
gc(reset = T)
if(nrow(files)==1){
  costs_and_constraints_2=cbind.data.frame(costs_and_constraints_2)
}
names(costs_and_constraints_2)=files$name

#### NUMERIC LAYERS ####

files=cat_by_layer[is.na(cat_by_layer$sum),c("archivo","name")]
n_cores=ifelse(nrow(files)<detectCores(),nrow(files),detectCores())
cl=makeCluster(n_cores,type="PSOCK")
registerDoParallel(cl,cores=n_cores)
costs_and_constraints_3=foreach(i=1:nrow(files),.inorder=T,.verbose=T,.packages=c("raster","exactextractr"),.combine=cbind.data.frame) %dopar%{
  df=raster(files$archivo[i])
  df=exact_extract(df, PUs_p, fun='mean')
  gc(reset = T)
  return(df)
}  
stopCluster(cl)
gc(reset = T)
if(nrow(files)==1){
  costs_and_constraints_3=cbind.data.frame(costs_and_constraints_2)
}
names(costs_and_constraints_3)=files$name

costs_and_constraints_3=cbind.data.frame(PUs_p$Id, costs_and_constraints_1, costs_and_constraints_2, costs_and_constraints_3)
rows=c()
for(i in costs){
  rows=c(rows,which(is.na(costs_and_constraints_3[,i])))
}
rows=sort(unique(rows))
if (length(rows)>0){
  costs_and_constraints_3=costs_and_constraints_3[-rows,]
}
names(costs_and_constraints_3)[1]="id"
costs_and_constraints_3=costs_and_constraints_3[order(costs_and_constraints_3$id),]
write.csv(costs_and_constraints_3,(paste0("C:/Clouds/Box/Proyectos_JBG/mesa_prioridades/Cambio_Global/input/PUs_",extension,"_",resolution,".csv")),row.names = F)

