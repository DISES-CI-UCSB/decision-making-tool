library(doParallel)
library(raster)
library(openxlsx)

extension="EJE_CAFETERO"
resolution="1km"

# DEFINE PUs

PUs=raster(paste0("C:/Clouds/Box/Proyectos_JBG/mesa_prioridades/PUs/PUS_",extension,"_",resolution,".tif"))
pu_ids=as.data.frame(PUs,na.rm=T)
names(pu_ids)="id"

# DELIMIT TO ONLY COSTS AND COSTRAINTS TO BE USED IN SCENARIOS

scenarios=read.xlsx("C:/Clouds/Box/Proyectos_JBG/mesa_prioridades/Cambio_Global/input/scenarios_to_run_v4_4_24_JBG.xlsx")
scenarios=scenarios[scenarios$SIRAP == extension,]
costs=unique(scenarios$costo)
scenarios=c(scenarios$costo,scenarios$inclusion,scenarios$exlusion)
scenarios=paste(scenarios,collapse=',')
scenarios=unique(strsplit(scenarios, ",")[[1]])
scenarios=scenarios[scenarios != "NA"]
#scenarios=c(scenarios,"SIRAP")
costs_and_constraints=read.xlsx("C:/Clouds/Box/Proyectos_JBG/mesa_prioridades/Cambio_Global/input/costs_and_constraints_v3_05_24.xlsx")
costs_and_constraints=costs_and_constraints[costs_and_constraints$name %in% scenarios,]
#costs=c("Huella_Humana")

# PRODUCE PU FILE INCLUDING COSTS AND CONSTRAINTS DATA 

files=unique(costs_and_constraints$archivo)
n_cores=ifelse(detectCores()<length(files),detectCores(),length(files))
cl=makeCluster(n_cores,type="PSOCK")
registerDoParallel(cl,cores=n_cores)
pu=foreach(i=files,.inorder=F,.verbose=T,.packages="raster") %dopar%{
  r=raster(i)
  test=try(compareRaster(r,PUs,extent=T,rowcol=T,crs=T,res=T),silent = T)
  if (class(test)=="try-error"){
    r=projectRaster(r,PUs,method="ngb")
  }
  r=as.data.frame(stack(PUs,r),na.rm=T)
  filter_costs_and_constraints=costs_and_constraints[costs_and_constraints$archivo==i,]
  names(r)=c("id",unique(filter_costs_and_constraints$name))
  rows=which(r[,2] %in% filter_costs_and_constraints$id_original)
  if (length(rows)>0){
    r=r[rows,]
  }
  r=merge(pu_ids,r,by="id",all.x=T)
  return(r)
  gc()
}
stopCluster(cl)
gc()
pu=Reduce(function(df1, df2) merge(df1, df2, by = "id", all.x = TRUE),pu)

rows=c()
for(i in costs){
  rows=c(rows,which(is.na(pu[,i])))
}
rows=sort(unique(rows))
if (length(rows)>0){
  pu=pu[-rows,]
}
pu=pu[order(pu$id),]
write.csv(pu,(paste0("C:/Clouds/Box/Proyectos_JBG/mesa_prioridades/Cambio_Global/input/PUs_",extension,"_",resolution,".csv")),row.names = F)

