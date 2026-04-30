#!/bin/bash

sourceBranch=$1
targetBranch=$2
workingDir=$3
startingCommit=$([ -z $4 ] && echo 1 || echo $4)

getNumberOfCommits() {
	branch=$1
	echo $(git log --oneline $branch | wc -l)
}

printBranchInfo() {
	branch=$1
	numberOfCommits=$(getNumberOfCommits $branch)
	echo "Branch: \`$branch\` has $numberOfCommits commits"
}

if [[ ($# == 0) ||  "$1" =~ ^(-h|--help)$ ]] ; then
	echo -e "The util will create a folder named '.branchCompare' inside the <working-dir> \nand save all the patches that appear in the <source-branch> and aren't presented in the <target-branch> \n"
	echo -e $"Usage: $0 <source-branch> <target-branch> [<working-dir] [<start-commit>] \n"
	echo "source-branch = The original branch '(upstream/master)'"
	echo "target-branch = The destination branch '(upstream/1.2.1)'"
	echo "working-dir = Git repository dir"
	echo -e "start-commit = How back to go (i.e. '150', will only compare 150 commits back) \n"
	echo "Example: './branchCompare.sh upstream/master upstream/1.2.0 ~/projects/nvmesh 100'"
	exit 0
fi

[[ ! -z "$workingDir" ]] && cd "$workingDir"

printBranchInfo "$sourceBranch"
printBranchInfo "$targetBranch"

numberOfCommits=$(getNumberOfCommits "$sourceBranch")

patchIndex=1

for x in $(eval echo {$(($numberOfCommits -$startingCommit))..$numberOfCommits}) ; do
	index=$((numberOfCommits-x))
	commit=$(git log -n 1 $sourceBranch~$index)
	commitId=$(echo $commit | cut -d ' ' -f 2)
	if [[ $commit =~ Change-Id:[[:space:]](I[0-9a-f]+)[[:space:]] ]] ; then
		changeId=${BASH_REMATCH[1]}
		isExists=$(git log --oneline $targetBranch --grep="Change-Id: $changeId" | wc -l)
		if [ "$isExists" -gt 0 ] ; then
			echo "Commit ($x/$numberOfCommits) was found in target branch"

		else
			if [ ! -d ./.branchCompare ] ; then
				mkdir ./.branchCompare
			fi

			cd ./.branchCompare
			patch=$(git format-patch -1 $commitId)
			patchWithoutIndexing=$(echo $patch | cut -d '-' -f 2-)
			mv $patch $(printf "%04d" $patchIndex)-$patchWithoutIndexing
			cd -
			patchIndex=$((patchIndex+1))
		fi
	else
		echo "No Change-Id found in commit '$commitId'!!"
	fi

done



