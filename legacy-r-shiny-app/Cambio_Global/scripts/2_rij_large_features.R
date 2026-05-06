library(doParallel)
library(raster)
library(fst)
library(openxlsx)
source("D:/OneDrive - Pontificia Universidad Javeriana/Common_Scripts/R/Defing groups for parallelizing.R")
extension="EJE_CAFETERO"

PUs=raster(paste0("D:/Box/Proyectos_JBG/mesa_prioridades/PUs/PUS_",extension,".tif"))
features=read.xlsx("D:/Box/Proyectos_JBG/mesa_prioridades/Cambio_Global/input/features_v4_4_24_(MAPV).xlsx")
features=features[-which(features$id_original == 0),]
features=features[features$id_elemento_priorizacion != 20,]
unique_features=read.xlsx("D:/Box/Proyectos_JBG/mesa_prioridades/Cambio_Global/input/scenarios_to_run_v4_4_24_JBG.xlsx")
unique_features=unique_features[unique_features$SIRAP==extension,]
unique_features=unique_features$id_elemento_priorizacion
unique_features=paste(unique_features,collapse=',')
unique_features=sort(unique(as.numeric(strsplit(unique_features, ",")[[1]])))
features=features[features$id_elemento_priorizacion %in% unique_features,]
features=features[!is.na(features$id_original),]
# result=read.fst("D:/Box/Proyectos_JBG/mesa_prioridades/Cambio_Global/input/rij_merged.fst")
# unique_features=unique(result$species)
# features=features[-which(features$id %in% unique_features),]

# CALCULATE RIJ FOR CATEGORICAL CONSERVATION FEATURES 

files=unique(features$archivo)
result=data.frame(pu=integer(),species=integer(),amount=numeric())

#n_cores=ifelse(detectCores()<length(files),detectCores(),length(files))
n_cores=8
groups=groups_for_parallelizing(length(files),n_cores)
rm("unique_features","groups_for_parallelizing")
gc(reset = T, full = T)
j=1
raster_files=files[groups[[j]]]
for(i in raster_files){
  r=raster(i)
  r=setMinMax(r)
  if (maxValue(r)==0){
    r=data.frame(pu=integer(),species=integer(),amount=numeric())
  }
  else{
    test=try(compareRaster(r,PUs,extent=T,rowcol=T,crs=T,res=T),silent = T)
    if (class(test)=="try-error"){
      r=projectRaster(r,PUs,method="ngb")
    }
    filter_features=features[features$archivo==i,]
    grid_value=unique(filter_features$id_original)
    if (nrow(filter_features)!=length(grid_value)){
      filter_features=filter_features[1,]
    }
    r=subs(r,filter_features,by="id_original",which="id",subsWithNA=T)*1
    r=as.data.frame(stack(PUs,r),na.rm=T)
    if (nrow(r)==0){
      r=data.frame(pu=integer(),species=integer(),amount=numeric())
    }
    else{
      names(r)=c("pu","species")
      r$amount=1
    }
  }
  result=rbind.data.frame(result,r)
  write.fst(result,paste0("D:/Box/Proyectos_JBG/mesa_prioridades/Cambio_Global/input/rij_cat_group_",j,".fst"),100)
  print(paste0(i," --> count:",nrow(r),", progress: ",which(raster_files==i)," from ",length(raster_files)))
  gc(reset = T, full = T)
}
gc(reset = T, full = T)